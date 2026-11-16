// Tap, double-tap, long-press and left/right swipes on one full-screen view,
// using React Native's built-in PanResponder (no extra packages).

import { useEffect, useRef } from 'react';
import { PanResponder } from 'react-native';
import { classifyTouch, DOUBLE_TAP_MS, LONG_PRESS_MS, TAP_MAX_MOVEMENT } from './gestures';

export type GestureHandlers = {
  onTap: () => void;
  onDoubleTap: () => void;
  onLongPress: () => void;
  onSwipe: (direction: 'swipeLeft' | 'swipeRight') => void;
};

export function useScreenGestures(handlers: GestureHandlers) {
  // Always call the latest handlers without re-creating the responder.
  const handlersRef = useRef(handlers);
  useEffect(() => {
    handlersRef.current = handlers;
  });

  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressed = useRef(false);

  useEffect(() => () => {
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
    if (tapTimer.current) clearTimeout(tapTimer.current);
  }, []);

  const responder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: () => {
      longPressed.current = false;
      longPressTimer.current = setTimeout(() => {
        longPressed.current = true;
        handlersRef.current.onLongPress();
      }, LONG_PRESS_MS);
    },
    onPanResponderMove: (_, g) => {
      if (Math.hypot(g.dx, g.dy) > TAP_MAX_MOVEMENT && longPressTimer.current) {
        clearTimeout(longPressTimer.current);
        longPressTimer.current = null;
      }
    },
    onPanResponderRelease: (_, g) => {
      if (longPressTimer.current) clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
      if (longPressed.current) return;

      const kind = classifyTouch(g.dx, g.dy);
      if (kind === 'swipeLeft' || kind === 'swipeRight') {
        handlersRef.current.onSwipe(kind);
      } else if (kind === 'tap') {
        if (tapTimer.current) {
          clearTimeout(tapTimer.current);
          tapTimer.current = null;
          handlersRef.current.onDoubleTap();
        } else {
          tapTimer.current = setTimeout(() => {
            tapTimer.current = null;
            handlersRef.current.onTap();
          }, DOUBLE_TAP_MS);
        }
      }
    },
    onPanResponderTerminate: () => {
      if (longPressTimer.current) clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    },
  })).current;

  return responder.panHandlers;
}
