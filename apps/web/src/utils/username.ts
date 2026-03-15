import { generateRandomName } from "./generateName";

const STORAGE_KEY = "puid-username";

export function getUsername(): string {
  if (typeof window === "undefined") return generateRandomName();
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored && stored.trim().length > 0) return stored;
  const name = generateRandomName();
  localStorage.setItem(STORAGE_KEY, name);
  return name;
}

export function setUsername(name: string): void {
  if (typeof window === "undefined") return;
  const trimmed = name.trim().slice(0, 32);
  if (trimmed.length === 0) {
    const generated = generateRandomName();
    localStorage.setItem(STORAGE_KEY, generated);
    return;
  }
  localStorage.setItem(STORAGE_KEY, trimmed);
}
