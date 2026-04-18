import { useState } from 'react';

export default function App() {
  const [count, setCount] = useState(0);
  return (
    <main>
      <h1>New Vite + React project</h1>
      <p>Edit <code>src/App.jsx</code> and save to hot-reload.</p>
      <button onClick={() => setCount((c) => c + 1)}>
        Clicked {count} time{count === 1 ? '' : 's'}
      </button>
    </main>
  );
}
