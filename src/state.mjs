export const PRODUCTS = [
  {
    sku: 'ERGO-27',
    name: 'Adjustable Laptop Stand',
    category: 'office',
    rating: 4.8,
    price: 68,
    inStock: true
  },
  {
    sku: 'CHAIR-14',
    name: 'Task Chair Cushion',
    category: 'office',
    rating: 4.2,
    price: 42,
    inStock: true
  },
  {
    sku: 'DOCK-9',
    name: 'USB-C Travel Dock',
    category: 'hardware',
    rating: 4.6,
    price: 119,
    inStock: false
  },
  {
    sku: 'BAG-22',
    name: 'Carry-On Organizer',
    category: 'travel',
    rating: 4.7,
    price: 36,
    inStock: true
  },
  {
    sku: 'MON-31',
    name: 'Portable Monitor',
    category: 'hardware',
    rating: 4.4,
    price: 229,
    inStock: true
  }
];

export const TICKETS = [
  {
    id: 'INC-1042',
    requester: 'Lin Chen',
    priority: 'Medium',
    topic: 'VPN profile reset',
    status: 'Open',
    reviewed: false
  },
  {
    id: 'INC-2048',
    requester: 'Priya Shah',
    priority: 'High',
    topic: 'Payroll portal timeout',
    status: 'Open',
    reviewed: false
  },
  {
    id: 'INC-3130',
    requester: 'Owen Brooks',
    priority: 'Low',
    topic: 'Printer badge mapping',
    status: 'Waiting',
    reviewed: false
  },
  {
    id: 'INC-4011',
    requester: 'Rina Patel',
    priority: 'Medium',
    topic: 'Calendar sync delay',
    status: 'Open',
    reviewed: false
  }
];

const initialState = {
  activeTaskId: 'onboarding-form',
  form: {
    fullName: '',
    email: '',
    role: '',
    startDate: '',
    notes: '',
    submitted: false
  },
  catalog: {
    search: '',
    category: 'all',
    minRating: 0,
    inStockOnly: false,
    selectedSku: ''
  },
  settings: {
    weeklyDigest: false,
    autosave: true,
    dataSharing: true,
    timezone: 'UTC'
  },
  table: {
    query: '',
    selectedTicketId: ''
  },
  tickets: TICKETS
};

export function snapshotState(value) {
  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
}

export function createInitialState(taskId = 'onboarding-form') {
  const state = snapshotState(initialState);
  state.activeTaskId = taskId;
  return state;
}

export function visibleProducts(state) {
  const query = state.catalog.search.trim().toLowerCase();
  return PRODUCTS.filter((product) => {
    const matchesQuery = !query
      || product.name.toLowerCase().includes(query)
      || product.sku.toLowerCase().includes(query);
    const matchesCategory = state.catalog.category === 'all'
      || product.category === state.catalog.category;
    const matchesRating = product.rating >= Number(state.catalog.minRating || 0);
    const matchesStock = !state.catalog.inStockOnly || product.inStock;
    return matchesQuery && matchesCategory && matchesRating && matchesStock;
  });
}

export function visibleTickets(state) {
  const query = state.table.query.trim().toLowerCase();
  if (!query) return state.tickets;

  return state.tickets.filter((ticket) => [
    ticket.id,
    ticket.requester,
    ticket.priority,
    ticket.topic,
    ticket.status
  ].some((value) => value.toLowerCase().includes(query)));
}

export function findProductBySku(sku) {
  return PRODUCTS.find((product) => product.sku === sku) || null;
}

export function findTicketById(state, id) {
  return state.tickets.find((ticket) => ticket.id === id) || null;
}

