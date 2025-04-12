import React, { useEffect, useRef } from 'react';
import nipplejs from 'nipplejs';
import { isMobile } from 'react-device-detect';
import { useKeyboardControls } from '@react-three/drei';

// Interface for control state
interface ControlState {
  forward: boolean;
  backward: boolean;
  left: boolean;
  right: boolean;
  fire: boolean;
}

// Styles for touch controls
const joystickStyle = {
  width: '100px',
  height: '100px',
  position: 'absolute',
  bottom: '20px',
  left: '20px',
};

const fireButtonStyle = {
  position: 'absolute',
  bottom: '20px',
  right: '20px',
  width: '60px',
  height: '60px',
  borderRadius: '50%',
  background: 'red',
  color: 'white',
  border: 'none',
  fontSize: '16px',
  cursor: 'pointer',
};

interface TouchControlsProps {
  controlsRef: React.MutableRefObject<ControlState>;
}

const TouchControls: React.FC<TouchControlsProps> = ({ controlsRef }) => {
  const joystickRef = useRef(null);
  const [, setControls] = useKeyboardControls();

  // Only render on mobile
  if (!isMobile) return null;

  useEffect(() => {
    // Initialize nipplejs joystick
    const manager = nipplejs.create({
      zone: joystickRef.current,
      mode: 'static',
      position: { left: '50%', top: '50%' },
      color: 'white',
    });

    // Map joystick movement to controls
    manager.on('move', (evt, data) => {
      const { force, angle } = data;
      const threshold = 0.3;

      // Calculate movement directions
      const forward = Math.cos(angle.radian) * force;
      const right = Math.sin(angle.radian) * force;

      // Update shared controls ref
      controlsRef.current = {
        forward: forward > threshold,
        backward: forward < -threshold,
        left: right < -threshold,
        right: right > threshold,
        fire: controlsRef.current.fire,
      };

      // Update keyboard controls for consistency
      setControls((state) => ({
        ...state,
        forward: forward > threshold,
        backward: forward < -threshold,
        left: right < -threshold,
        right: right > threshold,
      }));
    });

    // Reset movement controls when joystick is released
    manager.on('end', () => {
      controlsRef.current = {
        ...controlsRef.current,
        forward: false,
        backward: false,
        left: false,
        right: false,
      };

      setControls((state) => ({
        ...state,
        forward: false,
        backward: false,
        left: false,
        right: false,
      }));
    });

    // Cleanup joystick
    return () => manager.destroy();
  }, [controlsRef, setControls]);

  // Fire button handler
  const handleFire = () => {
    controlsRef.current = {
      ...controlsRef.current,
      fire: true,
    };

    setControls((state) => ({
      ...state,
      fire: true,
    }));

    // Reset fire after a short delay
    setTimeout(() => {
      controlsRef.current = {
        ...controlsRef.current,
        fire: false,
      };
      setControls((state) => ({
        ...state,
        fire: false,
      }));
    }, 100);
  };

  return (
    <>
      <div ref={joystickRef} style={joystickStyle} />
      <button onTouchStart={handleFire} style={fireButtonStyle}>
        Fire
      </button>
    </>
  );
};

export default TouchControls;