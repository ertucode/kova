export namespace FastIdentity {
  export function create() {
    const ID = Symbol('id')
    let symNextId = 1

    return function getIdSymbol(obj: any) {
      return (obj[ID] ??= symNextId++)
    }
  }
}
