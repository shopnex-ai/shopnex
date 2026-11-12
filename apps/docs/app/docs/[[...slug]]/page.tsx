import { DocsBody, DocsDescription, DocsPage, DocsTitle } from 'fumadocs-ui/page'
import { notFound } from 'next/navigation'
import { PageFeedback } from '@/components/page-feedback'
import { source } from '@/lib/source'
import { getMDXComponents } from '@/mdx-components'

const HOME_TITLE = 'ShopNex Docs: open-source commerce platform you run yourself'

export default async function Page(props: { params: Promise<{ slug?: string[] }> }) {
  const { slug } = await props.params
  const page = source.getPage(slug)
  if (!page) notFound()

  const MDX = page.data.body

  return (
    <DocsPage toc={page.data.toc} full={page.data.full}>
      <DocsTitle>{page.data.title}</DocsTitle>
      <DocsDescription>{page.data.description}</DocsDescription>
      <DocsBody>
        <MDX components={getMDXComponents()} />
        <PageFeedback
          path={page.path.replace(/\.mdx?$/, '')}
          title={page.data.title}
          verified={page.data.verified}
          verifiedVersion={page.data.verifiedVersion}
        />
      </DocsBody>
    </DocsPage>
  )
}

export function generateStaticParams() {
  return source.generateParams()
}

export async function generateMetadata(props: { params: Promise<{ slug?: string[] }> }) {
  const { slug } = await props.params
  const page = source.getPage(slug)
  if (!page) notFound()
  // The docs home is also the sidebar's "Introduction": give search results a title that says what the site is
  if (!slug?.length) return { title: { absolute: HOME_TITLE }, description: page.data.description }
  return { title: page.data.title, description: page.data.description }
}
