// Bounded plaintext input and recovery output. The existing earlier monitoring
// thresholds remain independent of this hard ceiling.
export const RECOVERY_MAX_BYTES = 128 * 1024 * 1024;
