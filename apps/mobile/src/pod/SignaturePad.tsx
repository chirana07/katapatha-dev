import { useMemo, useRef, useState } from "react";
import { PanResponder, View, Text, type LayoutChangeEvent } from "react-native";
import Svg, { Path } from "react-native-svg";
import { radius, space } from "@katapatha/tokens/tokens";
import { SecondaryButton } from "@/ui/Button";
import { themeFor, useTheme } from "@/ui/theme";
import { strokesToPaths, type Point, type Stroke } from "./signatureData";

/**
 * The signature is stored as dark ink on a transparent background (see
 * signatureData.ts) and is read later on light paper, so the signing surface is
 * ALWAYS paper-white with dark ink, in night mode too: what the recipient sees
 * is what is stored. Everything around it (the frame, the hint, the clear
 * button) follows the theme. The paper colours come from the light theme on
 * purpose, not by accident.
 */
const PAPER = themeFor("light").c;

/**
 * Where the recipient signs.
 *
 * PanResponder plus react-native-svg: the live stroke and the serialised SVG are
 * drawn from the same path data, so what the recipient saw is exactly what is
 * stored. A rasteriser (react-native-view-shot) would be a second native module
 * and a ~40 KB payload instead of a few KB.
 *
 * Points are collected in a ref and mirrored into state only at stroke boundaries.
 * Calling setState on every touch move would re-render the whole pad dozens of
 * times a second and make the line lag behind the finger.
 */
export function SignaturePad({
  strokes,
  onChange,
  onSize,
  disabled,
}: {
  strokes: Stroke[];
  onChange: (strokes: Stroke[]) => void;
  onSize: (size: { width: number; height: number }) => void;
  disabled?: boolean;
}) {
  const { c } = useTheme();
  const current = useRef<Point[]>([]);
  const [live, setLive] = useState<string>("");

  // react-hooks/refs objects to a ref being handed to a function during render.
  // Here that is unavoidable and safe: PanResponder is an imperative gesture API
  // whose callbacks need mutable state that survives between touch events, and
  // `current` is only ever read inside those callbacks -- never while rendering.
  // The alternative, setState on every touch move, re-renders the pad dozens of
  // times a second and makes the line visibly lag the finger.
  const responder = useMemo(
    () =>
      // eslint-disable-next-line react-hooks/refs
      PanResponder.create({
        onStartShouldSetPanResponder: () => !disabled,
        onMoveShouldSetPanResponder: () => !disabled,
        onPanResponderGrant: (event) => {
          const { locationX, locationY } = event.nativeEvent;
          current.current = [{ x: locationX, y: locationY }];
          setLive(`M ${Math.round(locationX)} ${Math.round(locationY)}`);
        },
        onPanResponderMove: (event) => {
          const { locationX, locationY } = event.nativeEvent;
          current.current.push({ x: locationX, y: locationY });
          setLive(
            (previous) => `${previous} L ${Math.round(locationX)} ${Math.round(locationY)}`,
          );
        },
        onPanResponderRelease: () => {
          if (current.current.length > 0) {
            onChange([...strokes, current.current]);
          }
          current.current = [];
          setLive("");
        },
      }),
    [disabled, onChange, strokes],
  );

  const handleLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    // Reported upward rather than kept here: the serialised SVG needs the viewBox,
    // and that belongs with whoever builds the data URL.
    onSize({ width, height });
  };

  const committed = strokesToPaths(strokes);

  return (
    <View style={{ gap: space.xs }}>
      <View
        onLayout={handleLayout}
        {...responder.panHandlers}
        accessibilityLabel="Signature area. Ask the recipient to sign with a finger."
        style={{
          height: 180,
          backgroundColor: PAPER.surface,
          borderWidth: 1,
          borderColor: c.line,
          borderRadius: radius.control,
          overflow: "hidden",
        }}
      >
        <Svg width="100%" height="100%">
          {committed.map((path, index) => (
            <Path
              key={index}
              d={path}
              stroke={PAPER.ink}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
          ))}
          {live ? (
            <Path
              d={live}
              stroke={PAPER.ink}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
          ) : null}
        </Svg>

        {committed.length === 0 && !live ? (
          <View
            pointerEvents="none"
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              bottom: space.xs,
              alignItems: "center",
            }}
          >
            <Text style={{ color: PAPER.muted, fontSize: 14 }}>
              Recipient signs here
            </Text>
          </View>
        ) : null}
      </View>

      <SecondaryButton
        label="Clear signature"
        disabled={disabled || committed.length === 0}
        onPress={() => {
          current.current = [];
          setLive("");
          onChange([]);
        }}
      />
    </View>
  );
}
