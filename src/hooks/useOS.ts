export type OS = "macos" | "windows" | "linux";

function detect(): OS {
  const ua = navigator.userAgent;
  if (ua.includes("Mac OS")) return "macos";
  if (ua.includes("Windows")) return "windows";
  return "linux";
}

// Evaluated once — the OS never changes during a session
export const currentOS: OS = detect();
