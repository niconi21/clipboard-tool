export type OS = "windows" | "linux";

function detect(): OS {
  const ua = navigator.userAgent;
  if (ua.includes("Windows")) return "windows";
  return "linux";
}

// Evaluated once — the OS never changes during a session
export const currentOS: OS = detect();
