'use client';
// If WebGL is missing or the scene throws, keep the debate readable: the text
// band and the transcript carry everything; the room is only decoration.
import { Component, type ReactNode } from 'react';
import { SceneFailed } from '@/lib/i18n';

export function hasWebGL() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch { return false; }
}

export default class SceneBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (this.state.failed) return <SceneFailed />;
    return this.props.children;
  }
}
