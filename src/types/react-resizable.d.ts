// src/types/react-resizable.d.ts
declare module 'react-resizable' {
  import * as React from 'react';

  export interface ResizeCallbackData {
    node: HTMLElement;
    size: { width: number; height: number };
    handle: string;
  }

  export interface ResizableProps {
    width: number;
    height: number;
    onResize?: (e: React.SyntheticEvent, data: ResizeCallbackData) => void;
    children?: React.ReactNode;
  }

  export class Resizable extends React.Component<ResizableProps> {}
  export class ResizableBox extends React.Component<ResizableProps> {}
}