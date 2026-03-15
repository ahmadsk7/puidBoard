const ADJECTIVES = [
  "Iron", "Neon", "Cyber", "Cosmic", "Velvet",
  "Turbo", "Shadow", "Crystal", "Hyper", "Golden",
  "Stealth", "Lunar", "Phantom", "Atomic", "Blazing",
  "Frozen", "Thunder", "Mystic", "Savage", "Radical",
];

const NOUNS = [
  "Moose", "Falcon", "Panther", "Cobra", "Phoenix",
  "Wolf", "Tiger", "Hawk", "Viper", "Lynx",
  "Raven", "Shark", "Dragon", "Mustang", "Jaguar",
  "Coyote", "Condor", "Mantis", "Badger", "Orca",
];

export function generateRandomName(): string {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)]!;
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)]!;
  const num = String(Math.floor(Math.random() * 100)).padStart(2, "0");
  return `${adj}${noun}${num}`;
}
