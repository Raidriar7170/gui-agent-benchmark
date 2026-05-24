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

export const INVOICES = [
  { id: 'INV-101', vendor: 'Northwind Labs', amount: 1240, status: 'Open' },
  { id: 'INV-117', vendor: 'Atlas Coffee', amount: 318, status: 'Open' },
  { id: 'INV-203', vendor: 'Priya Systems', amount: 4820, status: 'Open' },
  { id: 'INV-244', vendor: 'Bluebird Transit', amount: 760, status: 'Open' },
  { id: 'INV-305', vendor: 'Contour Legal', amount: 2190, status: 'Open' }
];

export const INVENTORY = [
  { sku: 'CABLE-12', name: 'USB-C Cable Pack', risk: 2, stock: 42 },
  { sku: 'BATT-88', name: 'Battery Pack Recall Kit', risk: 9, stock: 6 },
  { sku: 'LAMP-33', name: 'Desk Lamp', risk: 3, stock: 15 },
  { sku: 'HUB-51', name: 'Conference Hub', risk: 7, stock: 4 }
];

export const APPROVALS = [
  { id: 'APR-102', requester: 'Nia Carter', item: 'Database read access' },
  { id: 'APR-144', requester: 'Omar Singh', item: 'Travel reimbursement' },
  { id: 'APR-205', requester: 'Lena Ortiz', item: 'Vendor NDA renewal' },
  { id: 'APR-301', requester: 'Hiro Tanaka', item: 'Laptop refresh' }
];

export const AVAILABLE_UPLOADS = [
  'security-audit.pdf',
  'brand-guidelines.pdf',
  'office-map.png'
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
  tickets: TICKETS,
  modal: {
    selectedRequestId: '',
    dialogOpened: false,
    confirmed: false
  },
  pagination: {
    page: 1,
    reviewedIds: []
  },
  inventory: {
    sortKey: '',
    sortDirection: 'asc',
    selectedSku: ''
  },
  approvals: {
    selectedIds: [],
    submitted: false
  },
  validation: {
    title: '',
    owner: '',
    dueDate: '',
    errorShown: false,
    submitted: false
  },
  upload: {
    selectedFile: '',
    category: '',
    description: '',
    submitted: false
  }
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

export function visibleInvoices(state, pageSize = 2) {
  const page = Math.max(1, Number(state.pagination.page || 1));
  const start = (page - 1) * pageSize;
  return INVOICES.slice(start, start + pageSize);
}

export function sortedInventory(state) {
  const items = snapshotState(INVENTORY);
  if (state.inventory.sortKey === 'risk') {
    items.sort((left, right) => state.inventory.sortDirection === 'desc'
      ? right.risk - left.risk
      : left.risk - right.risk);
  }
  return items;
}

export function findProductBySku(sku) {
  return PRODUCTS.find((product) => product.sku === sku) || null;
}

export function findTicketById(state, id) {
  return state.tickets.find((ticket) => ticket.id === id) || null;
}

export function findInvoiceById(id) {
  return INVOICES.find((invoice) => invoice.id === id) || null;
}

export function findInventoryBySku(sku) {
  return INVENTORY.find((item) => item.sku === sku) || null;
}
