/// <reference types="vite/client" />

declare module 'milsymbol' {
  export type SymbolOptions = {
    size?: number;
    uniqueDesignation?: string;
    direction?: number;
  };
  export class Symbol {
    constructor(sidc: string, options?: SymbolOptions);
    asCanvas(): HTMLCanvasElement;
  }
  const milsymbol: { Symbol: typeof Symbol };
  export default milsymbol;
}
