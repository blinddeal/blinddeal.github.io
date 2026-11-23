export type Shot =
  | "deal"
  | "nodeal"
  | "lock"
  | "match"
  | "error"
  | "loading"
  | "pressed"
  | null;

export function currentShot(): Shot {
  const value = new URLSearchParams(window.location.search).get("shot");
  if (
    value === "deal" ||
    value === "nodeal" ||
    value === "lock" ||
    value === "match" ||
    value === "error" ||
    value === "loading" ||
    value === "pressed"
  ) {
    return value;
  }
  return null;
}
