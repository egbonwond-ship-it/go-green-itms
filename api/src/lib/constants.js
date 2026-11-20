// Shared reference data for the service desk.
const STATES = ['New', 'In Progress', 'On Hold', 'Resolved', 'Closed', 'Canceled'];
const OPEN_STATES = ['New', 'In Progress', 'On Hold'];
const TRANSITIONS = {
  New: ['In Progress', 'On Hold', 'Resolved', 'Canceled'],
  'In Progress': ['On Hold', 'Resolved', 'Canceled'],
  'On Hold': ['In Progress', 'Resolved', 'Canceled'],
  Resolved: ['Closed', 'In Progress'],
  Closed: [],
  Canceled: [],
};
const LEVELS = { 1: '1 - High', 2: '2 - Medium', 3: '3 - Low' };
const PRIORITIES = { 1: '1 - Critical', 2: '2 - High', 3: '3 - Moderate', 4: '4 - Low', 5: '5 - Planning' };
// [impact][urgency] -> priority (ServiceNow-style default matrix)
const PRIORITY_MATRIX = [
  [1, 2, 3],
  [2, 3, 4],
  [3, 4, 5],
];
// Resolution target per priority, in hours.
const SLA_HOURS = { 1: 4, 2: 8, 3: 24, 4: 72, 5: 120 };

const GROUPS = [
  'Service Desk',
  'Network & Connectivity',
  'End-User Hardware',
  'Software & Microsoft 365',
  'Telephony (3CX / VoIP)',
  'Security, CCTV & Access',
  'Power & Solar',
  'Cybersecurity',
];

const CATEGORIES = {
  'Inquiry / Help': ['How-to', 'Account', 'Other'],
  Hardware: ['Laptop / Desktop', 'Printer', 'Monitor', 'Peripheral', 'Mobile device'],
  Software: ['Microsoft 365', 'Email', 'Business application', 'Operating system', 'Installation'],
  Network: ['Internet', 'Wi-Fi', 'VPN', 'Structured cabling', 'Switch / Router'],
  Telephony: ['3CX IP-PBX', 'Desk phone', 'Softphone', 'Call quality'],
  Security: ['CCTV', 'Access control', 'Smart lock', 'Electric fence', 'Phishing / Malware'],
  'Power & Solar': ['Inverter', 'Battery', 'Solar panels', 'UPS', 'Generator changeover'],
  Request: ['Hardware', 'Software', 'Access', 'Onboarding', 'Other'],
};

const CONTACT_TYPES = ['Self-service', 'Phone', 'Email', 'Walk-in', 'WhatsApp', 'Monitoring'];
const RESOLUTION_CODES = [
  'Solved (Permanently)',
  'Solved (Workaround)',
  'Solved Remotely',
  'Solved On-site',
  'Not Solved (Not Reproducible)',
  'Not Solved (Too Costly)',
  'Closed/Resolved by Caller',
  'Fulfilled',
];

const SEED_CATALOG = [
  {
    name: 'New laptop',
    category: 'Hardware',
    icon: '💻',
    description: 'Request a standard business laptop for a new or existing staff member.',
    fulfillmentGroup: 'End-User Hardware',
    deliveryDays: 5,
    approvalRequired: true,
    fields: [
      { name: 'model', label: 'Model', type: 'select', required: true, options: ['Standard 14"', 'Performance 15"', 'Ultralight 13"'] },
      { name: 'user', label: 'Who is it for?', type: 'text', required: true, options: [] },
      { name: 'justification', label: 'Business justification', type: 'textarea', required: true, options: [] },
    ],
  },
  {
    name: 'Software installation',
    category: 'Software',
    icon: '🧩',
    description: 'Get approved software installed on your computer.',
    fulfillmentGroup: 'Software & Microsoft 365',
    deliveryDays: 2,
    fields: [
      { name: 'software', label: 'Software name and version', type: 'text', required: true, options: [] },
      { name: 'licence', label: 'Do you already have a licence?', type: 'checkbox', required: false, options: [] },
    ],
  },
  {
    name: 'Microsoft 365 account / mailbox',
    category: 'Access',
    icon: '✉️',
    description: 'Create a Microsoft 365 account, shared mailbox or distribution list.',
    fulfillmentGroup: 'Software & Microsoft 365',
    deliveryDays: 1,
    fields: [
      { name: 'kind', label: 'What do you need?', type: 'select', required: true, options: ['User account', 'Shared mailbox', 'Distribution list'] },
      { name: 'name', label: 'Full name or mailbox name', type: 'text', required: true, options: [] },
      { name: 'start', label: 'Needed by', type: 'date', required: false, options: [] },
    ],
  },
  {
    name: 'Password reset / account unlock',
    category: 'Access',
    icon: '🔑',
    description: 'Reset a password or unlock an account for any company system.',
    fulfillmentGroup: 'Service Desk',
    deliveryDays: 1,
    fields: [{ name: 'system', label: 'Which system?', type: 'select', required: true, options: ['Microsoft 365', 'Windows login', 'VPN', '3CX', 'Other'] }],
  },
  {
    name: 'VPN / remote access',
    category: 'Access',
    icon: '🛡️',
    description: 'Secure remote access to the company network.',
    fulfillmentGroup: 'Network & Connectivity',
    deliveryDays: 2,
    approvalRequired: true,
    fields: [{ name: 'reason', label: 'Why do you need remote access?', type: 'textarea', required: true, options: [] }],
  },
  {
    name: '3CX phone extension',
    category: 'Telephony',
    icon: '☎️',
    description: 'New 3CX extension, desk phone or softphone setup.',
    fulfillmentGroup: 'Telephony (3CX / VoIP)',
    deliveryDays: 2,
    fields: [
      { name: 'device', label: 'Device', type: 'select', required: true, options: ['Desk phone', 'Softphone (PC)', 'Mobile app'] },
      { name: 'user', label: 'Extension owner', type: 'text', required: true, options: [] },
    ],
  },
  {
    name: 'CCTV footage request',
    category: 'Security',
    icon: '📹',
    description: 'Request a copy of recorded CCTV footage for an incident.',
    fulfillmentGroup: 'Security, CCTV & Access',
    deliveryDays: 1,
    approvalRequired: true,
    fields: [
      { name: 'camera', label: 'Camera / location', type: 'text', required: true, options: [] },
      { name: 'date', label: 'Date of event', type: 'date', required: true, options: [] },
      { name: 'reason', label: 'Reason', type: 'textarea', required: true, options: [] },
    ],
  },
  {
    name: 'Access card / smart lock',
    category: 'Security',
    icon: '🚪',
    description: 'New access card, fob or smart-lock permission for a door.',
    fulfillmentGroup: 'Security, CCTV & Access',
    deliveryDays: 2,
    fields: [
      { name: 'doors', label: 'Doors / areas', type: 'text', required: true, options: [] },
      { name: 'user', label: 'Card holder', type: 'text', required: true, options: [] },
    ],
  },
  {
    name: 'New staff onboarding',
    category: 'Onboarding',
    icon: '👋',
    description: 'Everything a new starter needs: account, laptop, phone extension and access.',
    fulfillmentGroup: 'Service Desk',
    deliveryDays: 5,
    approvalRequired: true,
    fields: [
      { name: 'name', label: 'New starter full name', type: 'text', required: true, options: [] },
      { name: 'role', label: 'Job title', type: 'text', required: true, options: [] },
      { name: 'start', label: 'Start date', type: 'date', required: true, options: [] },
      { name: 'laptop', label: 'Needs a laptop', type: 'checkbox', required: false, options: [] },
      { name: 'phone', label: 'Needs a 3CX extension', type: 'checkbox', required: false, options: [] },
    ],
  },
  {
    name: 'Solar / inverter maintenance visit',
    category: 'Power & Solar',
    icon: '☀️',
    description: 'Schedule a service visit for your inverter, batteries or solar panels.',
    fulfillmentGroup: 'Power & Solar',
    deliveryDays: 3,
    fields: [
      { name: 'site', label: 'Site address', type: 'text', required: true, options: [] },
      { name: 'system', label: 'System', type: 'select', required: true, options: ['Inverter', 'Battery bank', 'Solar panels', 'Full system check'] },
      { name: 'preferred', label: 'Preferred date', type: 'date', required: false, options: [] },
    ],
  },
  {
    name: 'Network point / Wi-Fi access',
    category: 'Network',
    icon: '📶',
    description: 'New network cable point, Wi-Fi access for a device or guest Wi-Fi.',
    fulfillmentGroup: 'Network & Connectivity',
    deliveryDays: 3,
    fields: [
      { name: 'kind', label: 'Type', type: 'select', required: true, options: ['New cable point', 'Device Wi-Fi access', 'Guest Wi-Fi'] },
      { name: 'location', label: 'Location', type: 'text', required: true, options: [] },
    ],
  },
];

module.exports = {
  STATES,
  OPEN_STATES,
  TRANSITIONS,
  LEVELS,
  PRIORITIES,
  PRIORITY_MATRIX,
  SLA_HOURS,
  GROUPS,
  CATEGORIES,
  CONTACT_TYPES,
  RESOLUTION_CODES,
  SEED_CATALOG,
};
