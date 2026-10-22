import { z } from 'zod'

// Friendlier messages for admin forms. Client-only (imported by components/admin/form.tsx):
// API responses keep zod's defaults. Return undefined to fall back to the default message.
z.config({
  customError: (issue) => {
    if (issue.code === 'invalid_type') {
      if (issue.input === undefined || issue.input === null || issue.input === '') return 'Required'
      if (issue.expected === 'int') return 'Enter a whole number'
      if (issue.expected === 'number') return 'Enter a number'
    }
    if (issue.code === 'too_small' && issue.origin === 'string' && issue.minimum === 1) return 'Required'
    if (issue.code === 'too_small' && issue.origin === 'number' && issue.minimum === 0) return 'Must be 0 or more'
    if (issue.code === 'too_big' && issue.origin === 'string') return `Must be ${issue.maximum} characters or fewer`
    if (issue.code === 'invalid_format' && issue.format === 'email') return 'Enter a valid email'
    if (issue.code === 'invalid_format' && issue.format === 'url') return 'Enter a full URL (https://…)'
    return undefined
  },
})
