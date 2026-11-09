// Learn more https://docs.expo.io/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Bundle TensorFlow Lite models (assets/models/*.tflite) with the app.
config.resolver.assetExts.push('tflite');

module.exports = config;
