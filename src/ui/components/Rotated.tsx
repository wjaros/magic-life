import type { ComponentChildren } from 'preact';
import type { Rotation } from '../../core/types';

/**
 * Fills its (container-type: size) parent and rotates the content so that it reads
 * correctly for a player sitting at that side. For 90/270 the inner box swaps width/height.
 */
export function Rotated(props: { rotation: Rotation; class?: string; children: ComponentChildren }) {
  const swap = props.rotation === 90 || props.rotation === 270;
  return (
    <div
      class={`rot${swap ? ' swap' : ''} ${props.class ?? ''}`}
      style={{ '--rot': `${props.rotation}deg` }}
    >
      {props.children}
    </div>
  );
}
