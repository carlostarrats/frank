let count = 0;
const btn = document.getElementById('count-btn');
btn.addEventListener('click', () => {
  count += 1;
  btn.textContent = `Clicked ${count} time${count === 1 ? '' : 's'}`;
});
