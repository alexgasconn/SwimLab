import test from 'node:test';
import assert from 'node:assert/strict';
import { recordHistoryChart, recordPaceChart } from './charts.js';

class Node {
  constructor(name) { this.name = name; this.children = []; this.attributes = {}; }
  setAttribute(key, value) { this.attributes[key] = value; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
}

test('personal best pace chart labels every target distance, including missing records', () => {
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

test('personal best trend smooths the last three recorded periods and needs two periods', () => {
  const previous = globalThis.document;
  globalThis.document = {
    createElement: name => new Node(name),
    createElementNS: (_, name) => new Node(name),
  };
  try {
    const container = new Node('div');
    const rows = [100, 160, 130, 190].map((value, index) => {
      const entry = { id: String(index), name: 'Swim', date: `2026-0${index + 1}-01`, value };
      return { date: entry.date, entry, best: { ...entry, value: 100 } };
    });
    recordHistoryChart(container, rows.slice(0, 1), '100m freestyle', 'month');
    assert.equal(container.children[0].children.filter(node => node.attributes.class === 'record-history-trend').length, 0);
    recordHistoryChart(container, rows, '100m freestyle', 'month');
    const trend = container.children[0].children.find(node => node.attributes.class === 'record-history-trend');
    assert.equal(trend.attributes['stroke-dasharray'], '6 5');
    assert.match(trend.attributes.d, /^M[\d.]+,[\d.]+ Q/);
    const lastY = Number(trend.attributes.d.match(/([\d.]+),([\d.]+)$/)[2]);
    const expectedY = 215 - (160 - 89.2) / 111.6 * 195;
    assert.ok(Math.abs(lastY - expectedY) < 1e-8);
    recordHistoryChart(container, rows.slice(0, 2), '100m freestyle', 'week');
    assert.ok(container.children[0].children.some(node => node.attributes.class === 'record-history-trend'));
  } finally {
    globalThis.document = previous;
  }
});
