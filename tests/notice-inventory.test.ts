import { expect, it } from 'vitest'
import { productionPackagePaths } from '../scripts/notice-inventory'

it('许可目录保留别名下的不同版本、后续完整子树与可选依赖，不引入根开发依赖', () => {
  const trees = [
    {
      path: '/workspace',
      dependencies: {
        'sdk-v1': { path: '/packages/sdk-1' },
        'sdk-v0': {
          path: '/packages/sdk-0',
          dependencies: { uuid: { path: '/packages/uuid' } },
        },
        consumer: {
          path: '/packages/consumer',
          dependencies: {
            sdk: {
              path: '/packages/sdk-1',
              dependencies: { provider: { path: '/packages/provider' } },
            },
          },
          optionalDependencies: { native: { path: '/packages/native' } },
        },
      },
      devDependencies: { compiler: { path: '/packages/compiler' } },
    },
  ]
  expect(productionPackagePaths(trees)).toEqual([
    '/packages/consumer',
    '/packages/native',
    '/packages/provider',
    '/packages/sdk-0',
    '/packages/sdk-1',
    '/packages/uuid',
  ])
})
