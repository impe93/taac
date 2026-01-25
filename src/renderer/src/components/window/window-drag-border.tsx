import type { FC, CSSProperties } from 'react'

const dragStyle: CSSProperties = {
  WebkitAppRegion: 'drag'
} as CSSProperties

const BORDER_WIDTH = 12
const TRAFFIC_LIGHTS_HEIGHT = 32
const TRAFFIC_LIGHTS_WIDTH = 74

export const WindowDragBorder: FC = () => {
  const isMacOS = window.platform === 'darwin'

  return (
    <>
      {/* macOS: Traffic lights container with rounded bottom-right corner */}
      {isMacOS && (
        <div
          className="fixed left-0 top-0 z-50 rounded-br-md bg-border"
          style={{
            ...dragStyle,
            width: TRAFFIC_LIGHTS_WIDTH,
            height: TRAFFIC_LIGHTS_HEIGHT
          }}
        />
      )}

      {/* Top edge - on macOS starts after traffic lights area */}
      <div
        className="fixed right-0 top-0 z-50 bg-border"
        style={{
          ...dragStyle,
          left: isMacOS ? TRAFFIC_LIGHTS_WIDTH : 0,
          height: BORDER_WIDTH
        }}
      />

      {/* Right edge */}
      <div
        className="fixed bottom-0 right-0 top-0 z-50 bg-border"
        style={{
          ...dragStyle,
          width: BORDER_WIDTH
        }}
      />

      {/* Bottom edge */}
      <div
        className="fixed bottom-0 left-0 right-0 z-50 bg-border"
        style={{
          ...dragStyle,
          height: BORDER_WIDTH
        }}
      />

      {/* Left edge - on macOS starts below traffic lights area */}
      <div
        className="fixed bottom-0 left-0 z-50 bg-border"
        style={{
          ...dragStyle,
          width: BORDER_WIDTH,
          top: isMacOS ? TRAFFIC_LIGHTS_HEIGHT : 0
        }}
      />
    </>
  )
}

// Export constants for use in other components
export const WINDOW_BORDER_WIDTH = BORDER_WIDTH
export const WINDOW_TRAFFIC_LIGHTS_HEIGHT = TRAFFIC_LIGHTS_HEIGHT
