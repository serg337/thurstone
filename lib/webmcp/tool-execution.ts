export interface ToolExecutionContext {
  readonly signal?: AbortSignal;
}

export interface NativeToolCallContext extends ToolExecutionContext {
  readonly source: "native";
}

export function nativeToolCallContext(signal: AbortSignal | undefined): NativeToolCallContext {
  return signal ? { source: "native", signal } : { source: "native" };
}
