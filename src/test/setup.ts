import '@testing-library/jest-dom/vitest';
import { beforeAll } from 'vitest';
import { prepareAppLanguage } from '../app/i18n';

beforeAll(async () => {
  await prepareAppLanguage();
});
