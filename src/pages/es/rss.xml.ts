import rss from '@astrojs/rss';
import { getCollection } from 'astro:content';
import type { APIContext } from 'astro';

export async function GET(context: APIContext) {
  const isDev = import.meta.env.DEV;
  const now = new Date();
  const posts = (await getCollection('blog-es', ({ data }) => !data.draft && (isDev || data.date <= now)))
    .sort((a, b) => b.data.date.valueOf() - a.data.date.valueOf());

  return rss({
    title: 'Blog de Gugu Gifts',
    description:
      'Inspiración para regalar, historias de marcas y artesanos locales desde Gugu Gifts en Terrell, Texas.',
    site: context.site!.toString(),
    items: posts.map((post) => ({
      title: post.data.title,
      description: post.data.description,
      pubDate: post.data.date,
      link: `/es/blog/${post.id}`,
    })),
    customData: '<language>es-mx</language>',
  });
}
