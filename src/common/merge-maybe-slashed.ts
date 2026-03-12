export function mergeMaybeSlashed(str1: string, str2: string) {
  const hasSlash1 = str1[str1.length - 1] === "/";
  const hasSlash2 = str2[0] === "/";
  if (hasSlash1) {
    if (hasSlash2) {
      return str1 + str2.substring(1);
    } else {
      return str1 + str2;
    }
  } else {
    if (hasSlash2) {
      return str1 + str2;
    } else {
      return str1 + "/" + str2;
    }
  }
}
