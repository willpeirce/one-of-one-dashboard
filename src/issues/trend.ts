/** A new reason with no previous cases still needs at least three current cases. */
export const issueDoubled = (current: number, previous: number): boolean => current >= 3 && current >= previous * 2;
