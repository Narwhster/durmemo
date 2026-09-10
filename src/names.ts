import { Brand } from "effect";

export type Topic = string & Brand.Brand<"DurmemoTopic">;
export type KeyName = string & Brand.Brand<"DurmemoKey">;
export type SessionID = string & Brand.Brand<"DurmemoSessionID">;
export type ProjectCanonical = string & Brand.Brand<"DurmemoProjectCanonical">;

export const TOPIC_PATTERN = /^[a-z0-9][a-z0-9-_]{0,63}$/;
export const KEY_PATTERN = /^[a-z0-9][a-z0-9-_]{0,63}$/;
export const MAX_NAME_LENGTH = 64;

export const normalizeTopic = (input: string): Topic | null => {
  const normalized = input.trim().toLowerCase();
  if (normalized.length === 0 || normalized.length > MAX_NAME_LENGTH) return null;
  if (!TOPIC_PATTERN.test(normalized)) return null;
  return normalized as Topic;
};

export const normalizeKey = (input: string): KeyName | null => {
  const normalized = input.trim().toLowerCase();
  if (normalized.length === 0 || normalized.length > MAX_NAME_LENGTH) return null;
  if (!KEY_PATTERN.test(normalized)) return null;
  return normalized as KeyName;
};
