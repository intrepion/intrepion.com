"""Offline tests: only synthetic executables run, never an Android SDK."""
import importlib.util
import json
import os
from pathlib import Path
import signal
import socket
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import Mock, patch

SOURCE = Path(__file__).with_name('run_emulator_test.py')
spec = importlib.util.spec_from_file_location('runner', SOURCE)
runner_module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner_module)

FAKE = r"""
import json, os, signal, socket, sys, time
from pathlib import Path
root = Path(os.environ['ROOT'])
mode = os.environ.get('FAKE_MODE', '')
args = sys.argv[1:]
with (root / 'calls.jsonl').open('a') as f:
    f.write(json.dumps([os.getpid(), Path(sys.argv[0]).name, args]) + '\n')
if Path(sys.argv[0]).name == 'emulator':
    signal.signal(signal.SIGTERM, signal.SIG_IGN)
    while True: time.sleep(.01)
if 'nodaemon' in args:
    signal.signal(signal.SIGTERM, signal.SIG_IGN)
    if mode == 'server_stall':
        while True: time.sleep(.01)
    s = socket.socket()
    s.bind(('127.0.0.1', 5038))
    s.listen()
    while True:
        conn, _ = s.accept()
        # Let the readiness client close first so this fixed server port does
        # not retain TIME_WAIT between tests (notably on macOS).
        with conn:
            while conn.recv(1024):
                pass
if ('sys.boot_completed' in args and mode == 'adb_stall') or ('-d' in args and mode == 'logcat_stall'):
    signal.signal(signal.SIGTERM, signal.SIG_IGN)
    while True: time.sleep(.01)
if 'sys.boot_completed' in args:
    print('0' if mode == 'boot_timeout' else '1')
elif '-d' in args and mode != 'assertion_timeout':
    print('PASS: Android greeting, server identity, and invalid_argument')
"""


class StopTests(unittest.TestCase):
    def test_exited_process_is_not_signalled(self):
        runner = runner_module.Runner()
        proc = Mock(pid=12345)
        proc.poll.return_value = 0
        runner.owned.append(proc)
        with patch.object(runner_module.os, 'killpg') as killpg:
            runner.stop(proc)
        killpg.assert_not_called()
        proc.wait.assert_not_called()
        self.assertEqual(runner.owned, [])

    def test_successful_term_does_not_escalate(self):
        runner = runner_module.Runner()
        proc = Mock(pid=12345)
        proc.poll.side_effect = [None, 0]
        runner.owned.append(proc)
        with patch.object(runner_module.os, 'killpg') as killpg:
            runner.stop(proc)
        killpg.assert_called_once_with(12345, signal.SIGTERM)
        proc.wait.assert_called_once_with(timeout=runner.shutdown_grace)
        self.assertEqual(runner.owned, [])

    def test_exit_after_term_timeout_does_not_escalate(self):
        runner = runner_module.Runner()
        proc = Mock(pid=12345)
        proc.poll.side_effect = [None, 0, 0]
        proc.wait.side_effect = subprocess.TimeoutExpired('mock', 1)
        runner.owned.append(proc)
        with patch.object(runner_module.os, 'killpg') as killpg:
            runner.stop(proc)
        killpg.assert_called_once_with(12345, signal.SIGTERM)
        self.assertEqual(runner.owned, [])


class RunnerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.sdk = self.root / 'sdk'
        for relative in ('platform-tools/adb', 'emulator/emulator'):
            path = self.sdk / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text('#!' + sys.executable + '\n' + FAKE)
            path.chmod(0o755)
        for relative in ('android/build/outputs/apk/debug/connect-android-spike-debug.apk',
                         'avd/connect_dummy_api35.ini', 'avd/connect_dummy_api35.avd/config.ini'):
            path = self.root / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.touch()
        (self.root / 'android-user').mkdir()
        self.env = dict(os.environ, SDK=str(self.sdk), ROOT=str(self.root))
        # Shortened deadlines are test-only, not configurable in production.
        self.code = (
            "import importlib.util,sys;"
            "s=importlib.util.spec_from_file_location('r',sys.argv[1]);"
            "m=importlib.util.module_from_spec(s);s.loader.exec_module(m);"
            "m.Runner.boot_timeout=.35;m.Runner.assertion_timeout=.35;"
            "m.Runner.command_timeout=.6;m.Runner.shutdown_grace=.05;"
            "m.Runner.poll_interval=.01;sys.exit(m.main())"
        )

    def calls(self):
        path = self.root / 'calls.jsonl'
        return [json.loads(line) for line in path.read_text().splitlines()] if path.exists() else []

    def assert_clean(self):
        for pid, _, _ in self.calls():
            with self.assertRaises(ProcessLookupError, msg='owned process survived: ' + str(pid)):
                os.kill(pid, 0)

    def run_fake(self, mode=''):
        started = time.monotonic()
        result = subprocess.run([sys.executable, '-c', self.code, str(SOURCE)],
                                env=dict(self.env, FAKE_MODE=mode), capture_output=True, text=True, timeout=5)
        self.assertLess(time.monotonic() - started, 4)
        self.assert_clean()
        return result

    def test_missing_python_shell_prerequisite(self):
        result = subprocess.run(['/bin/bash', str(SOURCE.with_name('run-emulator-test.sh'))],
                                env=dict(self.env, PATH=''), capture_output=True, text=True, timeout=2)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('missing required tool: python3', result.stderr)
        self.assertEqual(self.calls(), [])

    def test_missing_environment_launches_nothing(self):
        self.env.pop('SDK')
        self.assertIn('Set SDK', self.run_fake().stderr)
        self.assertEqual(self.calls(), [])

    def test_missing_executable_launches_nothing(self):
        (self.sdk / 'platform-tools/adb').unlink()
        result = self.run_fake()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('missing executable', result.stderr)
        self.assertEqual(self.calls(), [])

    def test_missing_input_launches_nothing(self):
        (self.root / 'avd/connect_dummy_api35.ini').unlink()
        self.assertIn('missing readable input', self.run_fake().stderr)
        self.assertEqual(self.calls(), [])

    def test_each_reserved_port_is_guarded(self):
        for port in (5038, 5580, 5581):
            with self.subTest(port=port), socket.socket() as sock:
                sock.bind(('127.0.0.1', port))
                sock.listen()
                result = self.run_fake()
                self.assertIn('reserved test port ' + str(port), result.stderr)
                self.assertEqual(self.calls(), [])
                # Runner did not terminate or disturb the unrelated listener.
                self.assertNotEqual(sock.fileno(), -1)

    def test_success_and_stubborn_owned_process_cleanup(self):
        result = self.run_fake()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('PASS:', result.stdout)
        calls = self.calls()
        server = next(args for _, name, args in calls if 'nodaemon' in args)
        self.assertIn('--one-device', server)
        self.assertIn('connect_dummy_nonexistent_usb', server)
        emulator = next(args for _, name, args in calls if name == 'emulator')
        for flag in ('-no-window', '-no-audio', '-no-snapshot'):
            self.assertIn(flag, emulator)
        for flag, value in (('-port', '5580'), ('-cores', '2'), ('-memory', '1536'),
                            ('-camera-back', 'none'), ('-camera-front', 'none')):
            self.assertEqual(emulator[emulator.index(flag) + 1], value)
        commands = [args for _, name, args in calls if name == 'adb' and 'nodaemon' not in args]
        for args in commands:
            self.assertEqual(args[:6], ['-H', '127.0.0.1', '-P', '5038', '-s', 'emulator-5580'])
        tails = [args[6:] for args in commands]
        self.assertIn(['reverse', 'tcp:4100', 'tcp:4100'], tails)
        self.assertTrue(any(args[:2] == ['install', '-r'] for args in tails))
        self.assertLess(tails.index(['logcat', '-c']), next(i for i, args in enumerate(tails) if args[:2] == ['logcat', '-d']))

    def test_timeouts_cleanup_all_owned_processes(self):
        for mode in ('adb_stall', 'server_stall', 'boot_timeout', 'assertion_timeout', 'logcat_stall'):
            with self.subTest(mode=mode):
                (self.root / 'calls.jsonl').unlink(missing_ok=True)
                result = self.run_fake(mode)
                self.assertNotEqual(result.returncode, 0)
                self.assertRegex(result.stderr, 'timed out|deadline')

    def test_signals_cleanup(self):
        for sig in (signal.SIGINT, signal.SIGTERM):
            with self.subTest(signal=sig):
                (self.root / 'calls.jsonl').unlink(missing_ok=True)
                proc = subprocess.Popen([sys.executable, '-c', self.code, str(SOURCE)],
                                        env=dict(self.env, FAKE_MODE='adb_stall'),
                                        stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
                try:
                    deadline = time.monotonic() + 2
                    while len(self.calls()) < 3 and time.monotonic() < deadline:
                        time.sleep(.01)
                    proc.send_signal(sig)
                    _, stderr = proc.communicate(timeout=3)
                    self.assertNotEqual(proc.returncode, 0)
                    self.assertIn('interrupted by signal', stderr)
                    self.assert_clean()
                finally:
                    if proc.poll() is None:
                        proc.kill()
                        proc.wait(timeout=1)


if __name__ == '__main__':
    unittest.main()
