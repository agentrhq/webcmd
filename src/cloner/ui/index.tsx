import React from 'react';
import { render } from 'ink';
import { ClonerApp, type ClonerAppProps } from './App.js';

export function startInkCloner(
  initialUrl?: string,
  initialOptions?: ClonerAppProps['initialOptions']
) {
  const instance = render(<ClonerApp initialUrl={initialUrl} initialOptions={initialOptions} />);
  return instance;
}
