import { describe, it, expect } from 'vitest';
import { resolveImageUrl } from './imageUrl';

describe('resolveImageUrl', () => {
  it('returns undefined when imageUrl is undefined', () => {
    expect(resolveImageUrl('https://media.cdn-norce.tech/1496/', undefined)).toBeUndefined();
  });

  it('returns undefined when imageUrl is empty string', () => {
    expect(resolveImageUrl('https://media.cdn-norce.tech/1496/', '')).toBeUndefined();
  });

  it('returns absolute URL unchanged when imageUrl starts with https://', () => {
    expect(resolveImageUrl('https://media.cdn-norce.tech/1496/', 'https://x/y.jpg')).toBe('https://x/y.jpg');
  });

  it('returns absolute URL unchanged when imageUrl starts with http://', () => {
    expect(resolveImageUrl('https://media.cdn-norce.tech/1496/', 'http://x/y.jpg')).toBe('http://x/y.jpg');
  });

  it('returns imageUrl as-is when imageBaseUrl is undefined', () => {
    expect(resolveImageUrl(undefined, '123.jpg')).toBe('123.jpg');
  });

  it('returns imageUrl as-is when imageBaseUrl is empty string', () => {
    expect(resolveImageUrl('', '123.jpg')).toBe('123.jpg');
  });

  it('joins base URL ending with / and relative image URL', () => {
    expect(resolveImageUrl('https://media.cdn-norce.tech/1496/', '123.jpg')).toBe(
      'https://media.cdn-norce.tech/1496/123.jpg'
    );
  });

  it('joins base URL without trailing / and relative image URL', () => {
    expect(resolveImageUrl('https://media.cdn-norce.tech/1496', '123.jpg')).toBe(
      'https://media.cdn-norce.tech/1496/123.jpg'
    );
  });

  it('avoids double slash when base ends with / and image starts with /', () => {
    expect(resolveImageUrl('https://media.cdn-norce.tech/1496/', '/123.jpg')).toBe(
      'https://media.cdn-norce.tech/1496/123.jpg'
    );
  });

  it('handles base without trailing / and image with leading /', () => {
    expect(resolveImageUrl('https://media.cdn-norce.tech/1496', '/123.jpg')).toBe(
      'https://media.cdn-norce.tech/1496/123.jpg'
    );
  });

  it('preserves query strings in imageUrl', () => {
    expect(resolveImageUrl('https://media.cdn-norce.tech/1496/', '123.jpg?w=200&h=200')).toBe(
      'https://media.cdn-norce.tech/1496/123.jpg?w=200&h=200'
    );
  });

  it('preserves fragments in imageUrl', () => {
    expect(resolveImageUrl('https://media.cdn-norce.tech/1496/', '123.jpg#section')).toBe(
      'https://media.cdn-norce.tech/1496/123.jpg#section'
    );
  });

  it('preserves query strings and fragments in absolute URLs', () => {
    expect(resolveImageUrl('https://media.cdn-norce.tech/1496/', 'https://other.com/img.jpg?w=100#top')).toBe(
      'https://other.com/img.jpg?w=100#top'
    );
  });
});
