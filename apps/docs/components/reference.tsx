// Renders generated/reference.json (scripts/generate-reference.ts), which is read from the code at build time.
import reference from '../generated/reference.json'

const { scopes, webhooks, roles, env } = reference

function Table({ head, rows }: { head: string[]; rows: React.ReactNode[][] }) {
  return (
    <table>
      <thead>
        <tr>
          {head.map((h) => (
            <th key={h}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((cells, i) => (
          <tr key={i}>
            {cells.map((c, j) => (
              <td key={j}>{c}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/** Admin API scopes; a read_/write_ pair shares a row */
export function Scopes() {
  const rows: React.ReactNode[][] = []
  const seen = new Set<string>()
  for (const { scope, description } of scopes) {
    const resource = scope.replace(/^(read|write)_/, '')
    if (seen.has(resource)) continue
    seen.add(resource)
    const pair = scopes.filter((s) => s.scope.endsWith(`_${resource}`)).map((s) => <code key={s.scope}>{s.scope}</code>)
    rows.push([pair.flatMap((c, i) => (i ? [' / ', c] : [c])), description])
  }
  return <Table head={['Scope', 'Access']} rows={rows} />
}

export function WebhookTopics() {
  return (
    <Table
      head={['Topic', 'Fires when', 'Payload (data)']}
      rows={[
        ...webhooks.topics.map((t) => [
          <code key={t.topic}>{t.topic}</code>,
          t.description,
          <a key="p" href={`#payload-${t.payload}`}>
            {t.payload}
          </a>,
        ]),
        [
          <code key="test">{webhooks.testTopic}</code>,
          'You pressed Send test in the admin (not subscribable)',
          <code key="td">{'{ message, endpointId }'}</code>,
        ],
      ]}
    />
  )
}

export function WebhookPayloads() {
  return (
    <>
      {Object.entries(webhooks.payloads).map(([name, { fields }]) => (
        <div key={name} id={`payload-${name}`}>
          <h3>{name}</h3>
          <Table
            head={['Field', 'Type']}
            rows={fields.map((f) => [<code key={f.name}>{f.name}</code>, f.type + (f.nullable ? ' | null' : '')])}
          />
        </div>
      ))}
    </>
  )
}

/** "1m, 5m, 30m, ..." and the other delivery numbers, as one sentence */
export function WebhookDelivery() {
  const w = webhooks
  return (
    <>
      A response other than 2xx, or no response within {w.timeoutSeconds} seconds, is retried after{' '}
      {w.retrySchedule.join(', ')}; after that the delivery is marked failed. Finished deliveries are kept{' '}
      {w.retentionDays} days.
    </>
  )
}

export function Roles() {
  return <Table head={['Role', 'Can']} rows={roles.map((r) => [<code key={r.role}>{r.role}</code>, r.description])} />
}

/** Env var descriptions are markdown with `code` and [links](/docs/...), the only syntax they use */
function Inline({ text }: { text: string }) {
  return (
    <>
      {text.split(/(`[^`]+`|\[[^\]]+\]\([^)]+\))/g).map((part, i) => {
        if (part.startsWith('`')) return <code key={i}>{part.slice(1, -1)}</code>
        const link = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/)
        return link ? (
          <a key={i} href={link[2]}>
            {link[1]}
          </a>
        ) : (
          part
        )
      })}
    </>
  )
}

export function EnvVars() {
  return (
    <Table
      head={['Variable', 'Required', 'Default', 'Description']}
      rows={env.map((v) => [
        <code key={v.name}>{v.name}</code>,
        v.required ? 'yes' : 'no',
        v.default ? <Inline key="d" text={/^[\w./:-]+$/.test(v.default) ? `\`${v.default}\`` : v.default} /> : '',
        <Inline key="t" text={v.description} />,
      ])}
    />
  )
}
