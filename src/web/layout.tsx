import type { Child } from "hono/jsx";

export function Layout(props: { title: string; description: string; children: Child; canonical?: string; noIndex?: boolean }) {
  return <html lang="zh-CN">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <meta name="description" content={props.description} />
      {props.noIndex ? <meta name="robots" content="noindex,nofollow" /> : null}
      {props.canonical ? <link rel="canonical" href={props.canonical} /> : null}
      <meta property="og:title" content={props.title} />
      <meta property="og:description" content={props.description} />
      <meta property="og:type" content="website" />
      <title>{props.title}</title>
      <link rel="stylesheet" href="/styles.css" />
    </head>
    <body>
      <header class="site-header">
        <a class="wordmark" href="/" aria-label="One Good Read 首页"><span class="wordmark-dot" />ONE GOOD READ</a>
        <nav aria-label="主导航"><a href="/archive">Archive</a><a href="/about">About</a></nav>
      </header>
      <main>{props.children}</main>
      <footer><span>One thoughtful article, every day.</span><a href="/about">How it works</a></footer>
    </body>
  </html>;
}
