export function CounterModel() {
  const state = { count: 0 };
  return { state, increment() { state.count++; } };
}
