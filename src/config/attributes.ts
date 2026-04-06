// Standard attribute vocabulary for seller behaviors

export const STANDARD_ATTRIBUTES: Record<string, { label: string; values: Record<string, string> }> = {
  shipping_speed: {
    label: 'Shipping Speed',
    values: {
      same_day: 'Same Day',
      '1_2_days': '1-2 Days',
      '3_5_days': '3-5 Days',
      '1_week_plus': '1 Week+',
    },
  },
  response_time: {
    label: 'Response Time',
    values: {
      under_1h: 'Under 1 Hour',
      under_4h: 'Under 4 Hours',
      under_24h: 'Under 24 Hours',
      over_24h: 'Over 24 Hours',
    },
  },
  accepts_returns: {
    label: 'Accepts Returns',
    values: {
      yes: 'Yes',
      no: 'No',
      case_by_case: 'Case by Case',
    },
  },
  ships_nationwide: {
    label: 'Ships Nationwide',
    values: {
      yes: 'Yes',
      local_only: 'Local Only',
    },
  },
  selling_since: {
    label: 'Selling Since',
    values: {}, // Free-form year string
  },
}

// Keywords that map to attribute filters during query parsing
export const ATTRIBUTE_KEYWORDS: Record<string, { key: string; value: string }> = {
  'fast shipping': { key: 'shipping_speed', value: 'same_day' },
  'quick shipping': { key: 'shipping_speed', value: '1_2_days' },
  'same day': { key: 'shipping_speed', value: 'same_day' },
  'accepts returns': { key: 'accepts_returns', value: 'yes' },
  'free returns': { key: 'accepts_returns', value: 'yes' },
  'ships nationwide': { key: 'ships_nationwide', value: 'yes' },
  'nationwide shipping': { key: 'ships_nationwide', value: 'yes' },
  local: { key: 'ships_nationwide', value: 'local_only' },
  'local only': { key: 'ships_nationwide', value: 'local_only' },
  responsive: { key: 'response_time', value: 'under_1h' },
  'fast response': { key: 'response_time', value: 'under_4h' },
}
