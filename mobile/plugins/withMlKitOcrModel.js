// Asks Google Play services to download the ML Kit text recognition model when
// the app is installed, instead of on first use, so text reading also works
// if the phone is offline the first time the app runs.
const { withAndroidManifest, AndroidConfig } = require('expo/config-plugins');

module.exports = function withMlKitOcrModel(config) {
  return withAndroidManifest(config, (cfg) => {
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(cfg.modResults);
    AndroidConfig.Manifest.addMetaDataItemToMainApplication(
      app,
      'com.google.mlkit.vision.DEPENDENCIES',
      'ocr',
    );
    return cfg;
  });
};
