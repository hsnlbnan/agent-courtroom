// The person's motion preference, for code that decides at the moment of acting (sounds, scrolling).
export const prefersReducedMotion = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
