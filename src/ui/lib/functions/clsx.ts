import { twMerge } from "tailwind-merge";

type ClassValue = string | null | undefined | boolean;

export function clsx(...classes: ClassValue[]) {
  return classes.filter(Boolean).join(" ");
}

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(...inputs));
}
