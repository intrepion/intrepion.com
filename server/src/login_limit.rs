use std::{
    collections::HashMap,
    net::IpAddr,
    time::{Duration, Instant},
};

pub(crate) struct LoginLimiter {
    started: Instant,
    callers: HashMap<IpAddr, u32>,
    total: u32,
}

impl LoginLimiter {
    pub fn new() -> Self {
        Self {
            started: Instant::now(),
            callers: HashMap::new(),
            total: 0,
        }
    }

    pub fn allow(&mut self, caller: IpAddr) -> bool {
        if self.started.elapsed() >= Duration::from_secs(60) {
            self.started = Instant::now();
            self.callers.clear();
            self.total = 0;
        }
        // The global ceiling bounds both work and the in-memory caller map.
        if self.total >= 600 {
            return false;
        }
        let attempts = self.callers.entry(caller.to_canonical()).or_default();
        if *attempts >= 30 {
            return false;
        }
        *attempts += 1;
        self.total += 1;
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn scoped_limits_global_ceiling_and_expiry_are_bounded() {
        let mut limit = LoginLimiter::new();
        for caller in 1..=20 {
            let ip = format!("192.0.2.{caller}").parse().unwrap();
            for _ in 0..30 {
                assert!(limit.allow(ip));
            }
            assert!(!limit.allow(ip));
        }
        assert!(!limit.allow("198.51.100.1".parse().unwrap()));
        assert_eq!(limit.callers.len(), 20);
        limit.started = Instant::now() - Duration::from_secs(61);
        assert!(limit.allow("198.51.100.1".parse().unwrap()));
        assert_eq!(limit.callers.len(), 1);
        assert_eq!(limit.total, 1);
    }
}
