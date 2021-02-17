import i18next from "i18next";
import deprecationWarning from "../Core/deprecationWarning";
/**
 * Takes a given string and translates it if it exists, otherwise return
 */
export function useTranslationIfExists(keyOrString: string) {
  if (keyOrString && keyOrString.indexOf("translate#") === 0) {
    const translationKey = keyOrString.substr("translate#".length);
    return i18next.exists(translationKey)
      ? i18next.t(translationKey)
      : translationKey;
  } else if (keyOrString) {
    deprecationWarning(
      "useTranslationIfExists",
      "Using translation key inside config without `translate#` prefix is deprecated"
    );
    // after the depreaction
    // return keyOrString;
    return i18next.exists(keyOrString) ? i18next.t(keyOrString) : keyOrString;
  } else {
    return keyOrString;
  }
}
