import test from 'node:test';
import assert from 'node:assert/strict';
import { recordPaceChart } from './charts.js';

test('personal best pace chart labels every target distance, including missing records', () => {
  class Node {
    constructor(name) { this.name = name; this.children = []; this.attributes = {}; }
    setAttribute(key, value) { this.attributes[key] = value; }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
  }
  const previous = globalThis.document;
  globalThis.document = {
    createElement: name => new Node(name),
    createElementNS: (_, name) => new Node(name),
  };
  try {
    const container = new Node('div');
    const rows = [40, 50, 80, 100].map(distance => ({ distance }));
    rows[1].entry = { id: 'a', name: 'Swim', date: '2026-01-01', pace: 100 };
    recordPaceChart(container, rows);
    const svg = container.children[0];
    assert.deepEqual(svg.children.filter(node => node.name === 'text' && ['40', '50', '80', '100'].includes(node.textContent))
      .map(node => node.textContent), ['40', '50', '80', '100']);
    assert.equal(svg.children.filter(node => node.name === 'a').length, 1);
    recordPaceChart(container, rows.map(({ distance }) => ({ distance })));
    assert.match(container.children[1].textContent, /40, 50, 80, 100/);
  } finally {
    globalThis.document = previous;
  }
});
