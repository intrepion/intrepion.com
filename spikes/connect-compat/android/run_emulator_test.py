#!/usr/bin/env python3
"""POSIX runner. Python 3 standard library only; requires a prepared SDK/workspace."""
import os
from pathlib import Path
import signal
import socket
import subprocess
import sys
import tempfile
import time


class Failure(Exception):
    pass


class Runner:
    boot_timeout = 300
    assertion_timeout = 60
    command_timeout = 30
    shutdown_grace = 1
    poll_interval = 2

    def __init__(self):
        self.owned = []
        self.server = None
        self.spawning = False
        self.pending_signal = None

    def preflight(self):
        for key in ('SDK', 'ROOT'):
            if not os.environ.get(key):
                raise Failure('Set ' + key + ' to the existing isolated SDK/workspace')
        self.root = Path(os.environ['ROOT'])
        sdk = Path(os.environ['SDK'])
        self.adb = sdk / 'platform-tools/adb'
        self.emulator_bin = sdk / 'emulator/emulator'
        self.apk = self.root / 'android/build/outputs/apk/debug/connect-android-spike-debug.apk'
        for tool in (self.adb, self.emulator_bin):
            if not tool.is_file() or not os.access(tool, os.X_OK):
                raise Failure('missing executable: ' + str(tool))
        for path in (self.apk, self.root / 'avd/connect_dummy_api35.ini',
                     self.root / 'avd/connect_dummy_api35.avd/config.ini'):
            if not path.is_file() or not os.access(path, os.R_OK):
                raise Failure('missing readable input: ' + str(path))
        for path in (self.root, self.root / 'android', self.root / 'android-user'):
            if not path.is_dir() or not os.access(path, os.W_OK):
                raise Failure('workspace directory must exist and be writable: ' + str(path))
        guards = []
        try:
            for port in (5038, 5580, 5581):
                for family, address in ((socket.AF_INET, '0.0.0.0'), (socket.AF_INET6, '::')):
                    if family == socket.AF_INET6 and not socket.has_ipv6:
                        continue
                    sock = socket.socket(family, socket.SOCK_STREAM)
                    guards.append(sock)
                    if family == socket.AF_INET6:
                        sock.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 1)
                    try:
                        sock.bind((address, port))
                    except OSError as exc:
                        raise Failure('reserved test port %s is unavailable; no changes made: %s' % (port, exc))
        finally:
            for sock in guards:
                sock.close()
        self.env = dict(os.environ, ANDROID_AVD_HOME=str(self.root / 'avd'),
                        ANDROID_USER_HOME=str(self.root / 'android-user'),
                        ANDROID_EMULATOR_HOME=str(self.root / 'android-user'),
                        ANDROID_ADB_SERVER_PORT='5038', ADB_MDNS_AUTO_CONNECT='',
                        ADB_VENDOR_KEYS=str(self.root / 'android-user/adbkey'))
        self.env.pop('ADB_SERVER_SOCKET', None)

    def launch(self, args, output):
        # Register a child before processing cancellation.
        self.spawning = True
        try:
            proc = subprocess.Popen([str(arg) for arg in args], env=self.env,
                                    stdin=subprocess.DEVNULL, stdout=output,
                                    stderr=subprocess.STDOUT, start_new_session=True)
            self.owned.append(proc)
        finally:
            self.spawning = False
        if self.pending_signal is not None:
            raise Failure("interrupted by signal " + str(self.pending_signal))
        return proc

    def stop(self, proc):
        # Never send adb kill-server/emu kill to a potentially replaced service.
        # Once the leader exits, its PID/group identity is no longer ours to
        # signal safely. Do not attempt descendant cleanup after leader exit.
        for sig in (signal.SIGTERM, signal.SIGKILL):
            if proc.poll() is not None:
                break
            try:
                os.killpg(proc.pid, sig)
            except ProcessLookupError:
                pass
            try:
                proc.wait(timeout=self.shutdown_grace)
            except subprocess.TimeoutExpired:
                continue
            else:
                break
        if proc.poll() is not None and proc in self.owned:
            self.owned.remove(proc)

    def cleanup(self):
        for proc in list(reversed(self.owned)):
            self.stop(proc)

    def command(self, args, deadline=None, allow_failure=False):
        if self.server.poll() is not None:
            raise Failure('owned adb server exited')
        remaining = self.command_timeout
        if deadline is not None:
            remaining = min(remaining, deadline - time.monotonic())
        if remaining <= 0:
            raise Failure('phase deadline exceeded')
        with tempfile.TemporaryFile() as output:
            # Explicit -H connects to this foreground server without adb's
            # local-server auto-start fallback if it exits between checks.
            proc = self.launch([self.adb, '-H', '127.0.0.1', '-P', '5038', '-s', 'emulator-5580', *args], output)
            try:
                proc.wait(timeout=remaining)
            except subprocess.TimeoutExpired:
                raise Failure('command timed out: ' + ' '.join(args))
            finally:
                self.stop(proc)
            output.seek(0)
            result = output.read().decode('utf-8', errors='replace')
        if proc.returncode and not allow_failure:
            raise Failure('command failed: ' + ' '.join(args) + '\n' + result)
        return result

    def run(self):
        self.preflight()
        with (self.root / 'adb-server.log').open('w') as adb_log, (self.root / 'emulator.log').open('w') as emu_log:
            # Foreground mode gives us the server PID; do not launch a daemon.
            self.server = self.launch([self.adb, '-P', '5038', '--one-device',
                                       'connect_dummy_nonexistent_usb', 'server', 'nodaemon'], adb_log)
            ready_by = time.monotonic() + self.command_timeout
            while True:
                if self.server.poll() is not None:
                    raise Failure('owned adb server failed; see adb-server.log')
                try:
                    with socket.create_connection(('127.0.0.1', 5038), timeout=.1):
                        break
                except OSError:
                    if time.monotonic() >= ready_by:
                        raise Failure('adb server startup timed out')
                    time.sleep(min(.05, max(0, ready_by - time.monotonic())))
            emulator = self.launch([self.emulator_bin, '-avd', 'connect_dummy_api35', '-port', '5580',
                '-no-window', '-no-audio', '-no-boot-anim', '-no-snapshot', '-camera-back', 'none',
                '-camera-front', 'none', '-gpu', 'software', '-cores', '2', '-memory', '1536'], emu_log)
            deadline = time.monotonic() + self.boot_timeout
            while True:
                if emulator.poll() is not None:
                    raise Failure('emulator exited; see emulator.log')
                if self.command(['shell', 'getprop', 'sys.boot_completed'], deadline, True).strip() == '1':
                    break
                if time.monotonic() >= deadline:
                    raise Failure('emulator boot deadline exceeded')
                time.sleep(min(self.poll_interval, max(0, deadline - time.monotonic())))
            for args in (['shell', 'getprop', 'ro.build.version.sdk'],
                         ['shell', 'getprop', 'ro.product.cpu.abi'],
                         ['reverse', 'tcp:4100', 'tcp:4100'],
                         ['install', '-r', str(self.apk)], ['logcat', '-c'],
                         ['shell', 'am', 'start', '-W', '-n', 'com.intrepion.spike/.MainActivity']):
                print(self.command(args), end='')
            deadline = time.monotonic() + self.assertion_timeout
            while True:
                result = self.command(['logcat', '-d', '-s', 'ConnectSpike:I', '*:S'], deadline)
                (self.root / 'android/runtime.log').write_text(result)
                if 'FAIL' in result:
                    raise Failure(result)
                if 'PASS: Android greeting, server identity, and invalid_argument' in result:
                    print(result, end='')
                    return
                if time.monotonic() >= deadline:
                    raise Failure('no result within assertion deadline')
                time.sleep(min(self.poll_interval, max(0, deadline - time.monotonic())))


def main():
    runner = Runner()
    def interrupted(signum, _frame):
        if runner.spawning:
            runner.pending_signal = signum
        else:
            raise Failure('interrupted by signal ' + str(signum))
    previous = {sig: signal.signal(sig, interrupted) for sig in (signal.SIGINT, signal.SIGTERM)}
    try:
        runner.run()
        return 0
    except (Failure, OSError) as exc:
        print('FAIL: ' + str(exc), file=sys.stderr)
        return 1
    finally:
        for sig in previous:
            signal.signal(sig, signal.SIG_IGN)
        runner.cleanup()
        for sig, handler in previous.items():
            signal.signal(sig, handler)


if __name__ == '__main__':
    sys.exit(main())
