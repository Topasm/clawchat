import '@testing-library/jest-dom';
import { beforeAll } from 'vitest';
import { prepareAppLanguage } from '../app/i18n';

beforeAll(async () => {
  await prepareAppLanguage();
});
