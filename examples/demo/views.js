function node(tag, name, text) {
  const element = document.createElement(tag);
  element.dataset.n = name;
  if (text !== undefined) element.textContent = text;
  return element;
}

export function CounterView(model) {
  const root = node('section', 'demo-counter');
  const heading = node('h2', 'demo-counter-title', '独立的组件实例');
  const value = node('p', 'demo-counter-value');
  value.setAttribute('aria-live', 'polite');
  const button = node('button', 'demo-counter-increment', '加一');
  button.type = 'button';
  const render = () => { value.textContent = `当前计数：${model.state.count}`; };
  button.addEventListener('click', () => { model.increment(); render(); });
  render();
  root.append(heading, value, button);
  return root;
}

export function HomeView(model) {
  const root = node('main', 'demo-home');
  root.append(
    node('h1', 'demo-home-title', '芥子纳须弥'),
    node('p', 'demo-home-description', '把页面和组件放在同一张画布里。双击 Frame 标题，进入详情后试试按钮和节点框选。'),
    CounterView(model),
  );
  return root;
}
