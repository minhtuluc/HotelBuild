'use client';

/**
 * Ràng buộc React cho danh mục câu chữ. Chỉ chứa phần cần client (context/hook);
 * danh mục và bộ nội suy thuần nằm ở `./messages` để server component dùng được.
 */
import { createContext, createElement, useContext, type ReactElement, type ReactNode } from 'react';
import { makeTranslate, viCatalog, type Catalog, type Translate } from './messages.js';

const defaultTranslate: Translate = makeTranslate(viCatalog);

const TranslateContext = createContext<Translate>(defaultTranslate);

export function useTranslate(): Translate {
  return useContext(TranslateContext);
}

export function I18nProvider({
  catalog = viCatalog,
  children,
}: {
  catalog?: Catalog;
  children: ReactNode;
}): ReactElement {
  return createElement(TranslateContext.Provider, { value: makeTranslate(catalog) }, children);
}
