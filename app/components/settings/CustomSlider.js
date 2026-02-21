import React, { useRef, useState, useMemo } from 'react';
import { View, StyleSheet, PanResponder } from 'react-native';
import { theme } from '../../config/theme';

/**
 * CustomSlider - A pure React Native slider component (no external dependencies).
 *
 * Props:
 *  - value (number): Current value
 *  - onValueChange (function): Called as the slider moves
 *  - onSlidingComplete (function): Called when the user releases the thumb
 *  - minimumValue (number): Minimum value (default 0)
 *  - maximumValue (number): Maximum value (default 1)
 *  - step (number): Step increment (default 0, meaning continuous)
 *  - disabled (bool): Whether the slider is disabled
 *  - minimumTrackTintColor (string): Color of the filled track
 *  - maximumTrackTintColor (string): Color of the unfilled track
 *  - thumbTintColor (string): Color of the thumb
 */
export default function CustomSlider({
  value = 0,
  onValueChange,
  onSlidingComplete,
  minimumValue = 0,
  maximumValue = 1,
  step = 0,
  disabled = false,
  minimumTrackTintColor = theme.colors.primary,
  maximumTrackTintColor = theme.colors.border,
  thumbTintColor = theme.colors.primary,
}) {
  const trackRef = useRef(null);
  const [isSliding, setIsSliding] = useState(false);

  // Use refs to avoid stale closures in PanResponder
  const propsRef = useRef({});
  propsRef.current = {
    onValueChange,
    onSlidingComplete,
    minimumValue,
    maximumValue,
    step,
    disabled,
    value,
  };

  const computeValue = (pageX) => {
    return new Promise((resolve) => {
      const { minimumValue: min, maximumValue: max, step: s } = propsRef.current;
      if (trackRef.current) {
        trackRef.current.measure((_x, _y, width, _height, px) => {
          if (width <= 0) {
            resolve(propsRef.current.value);
            return;
          }
          const relativeX = pageX - px;
          const fraction = Math.min(Math.max(relativeX / width, 0), 1);
          let raw = min + fraction * (max - min);
          if (s > 0) {
            raw = Math.round((raw - min) / s) * s + min;
            raw = Math.min(Math.max(raw, min), max);
          }
          resolve(raw);
        });
      } else {
        resolve(propsRef.current.value);
      }
    });
  };

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => !propsRef.current.disabled,
        onMoveShouldSetPanResponder: () => !propsRef.current.disabled,
        onPanResponderGrant: async (evt) => {
          setIsSliding(true);
          const newValue = await computeValue(evt.nativeEvent.pageX);
          propsRef.current.onValueChange?.(newValue);
        },
        onPanResponderMove: async (evt) => {
          const newValue = await computeValue(evt.nativeEvent.pageX);
          propsRef.current.onValueChange?.(newValue);
        },
        onPanResponderRelease: async (evt) => {
          setIsSliding(false);
          const newValue = await computeValue(evt.nativeEvent.pageX);
          propsRef.current.onSlidingComplete?.(newValue);
        },
        onPanResponderTerminate: () => {
          setIsSliding(false);
        },
      }),
    []
  );

  const range = maximumValue - minimumValue;
  const fraction = range > 0 ? (value - minimumValue) / range : 0;
  const percentage = Math.min(Math.max(fraction * 100, 0), 100);

  return (
    <View
      style={[styles.container, disabled && styles.disabledContainer]}
      ref={trackRef}
      {...panResponder.panHandlers}
    >
      <View style={styles.trackContainer}>
        <View
          style={[
            styles.track,
            { backgroundColor: maximumTrackTintColor },
          ]}
        >
          <View
            style={[
              styles.filledTrack,
              {
                width: `${percentage}%`,
                backgroundColor: disabled
                  ? theme.colors.disabled
                  : minimumTrackTintColor,
              },
            ]}
          />
        </View>
        <View
          style={[
            styles.thumb,
            {
              left: `${percentage}%`,
              backgroundColor: disabled
                ? theme.colors.disabled
                : thumbTintColor,
              transform: [
                { translateX: -10 },
                { scale: isSliding ? 1.2 : 1 },
              ],
            },
          ]}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    height: 36,
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  disabledContainer: {
    opacity: 0.5,
  },
  trackContainer: {
    height: 36,
    justifyContent: 'center',
    position: 'relative',
  },
  track: {
    height: 4,
    borderRadius: 2,
    overflow: 'hidden',
  },
  filledTrack: {
    height: '100%',
    borderRadius: 2,
  },
  thumb: {
    position: 'absolute',
    width: 20,
    height: 20,
    borderRadius: 10,
    top: 8,
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
  },
});
