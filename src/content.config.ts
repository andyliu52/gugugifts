import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const postSchema = z.object({
  title: z.string(),
  description: z.string(),
  date: z.coerce.date(),
  tags: z.array(z.string()).default([]),
  author: z.string().default('Gugu Gifts'),
  draft: z.boolean().default(false),
  heroImage: z.string().optional(),
});

const blog = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/blog' }),
  schema: postSchema,
});

const blogEs = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/blog-es' }),
  schema: postSchema,
});

export const collections = { blog, 'blog-es': blogEs };
