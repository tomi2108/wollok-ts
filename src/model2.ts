import { Index } from 'parsimmon'
import { divideOn, mapObject } from './extensions'

const { isArray } = Array
const { values, assign } = Object


export type Name = string
export type Id = string
export type List<T> = ReadonlyArray<T>

export type Payload<T> = { [P in PayloadKey<T>]: T[P] }
type PayloadKey<T> = { [K in keyof T]:
  K extends 'kind' ? never :
  T[K] extends Function ? never :
  undefined extends T[K] ? never :
  K
}[keyof T]

// ══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// CACHE
// ══════════════════════════════════════════════════════════════════════════════════════════════════════════════════

export const isNode = <S extends Stage>(obj: any): obj is Node<S> => !!(obj && obj.kind)

function cached(target: any, propertyKey: string, descriptor: PropertyDescriptor) {
  const originalMethod = descriptor.value
  descriptor.value = function () {
    const args = arguments
    const key = `${propertyKey}(${args})`
    const cachedResponse = target.cache?.[key]
    if (cachedResponse) return cachedResponse
    const result = originalMethod.apply(this, args)
    target.cache = { ...target.cache, [key]: result }
    return result
  }
}

// ══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// STAGES
// ══════════════════════════════════════════════════════════════════════════════════════════════════════════════════

export type Stage = Raw | Filled | Linked
export abstract class Raw { protected readonly rawTag = 'Raw' }
export abstract class Filled extends Raw { protected readonly filledTag = 'Filled' }
export abstract class Linked extends Filled { protected readonly linkedTag = 'Linked' }
export type Final = Linked

type Stageable<S extends Stage, C extends Stage, T> = S extends C ? T : T | undefined
type Fillable<S extends Stage, T> = Stageable<S, Filled, T>
type Linkable<S extends Stage, T> = Stageable<S, Linked, T>

// ══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// NODES
// ══════════════════════════════════════════════════════════════════════════════════════════════════════════════════

export type Kind = Node['kind']
export type KindOf<N extends Node<any>> = N['kind']
export type Category = 'Entity' | 'Module' | 'Sentence' | 'Expression'
export type NodeOfKind<K extends Kind, S extends Stage> = Extract<Node<S>, { kind: K }>
export type NodeOfCategory<C extends Category, S extends Stage> =
  C extends 'Entity' ? Entity<S> :
  C extends 'Module' ? Module<S> :
  C extends 'Sentence' ? Sentence<S> :
  C extends 'Expression' ? Expression<S> :
  never
export type NodeOfKindOrCategory<Q extends Kind | Category, S extends Stage> =
  Q extends Kind ? NodeOfKind<Q, S> :
  Q extends Category ? NodeOfCategory<Q, S> :
  never

export interface Source {
  readonly file?: string
  readonly start: Index
  readonly end: Index
}

export type Scope = Record<Name, Id>


export type Node<S extends Stage = Final>
  = Parameter<S>
  | Self<S>
  | NamedArgument<S>
  | Import<S>
  | Body<S>
  | Catch<S>
  | Entity<S>
  | DescribeMember<S>
  | ClassMember<S>
  | Sentence<S>
  | Environment<S>


abstract class $Node<S extends Stage> {
  readonly stage?: S

  abstract readonly kind: Kind

  readonly id!: Linkable<S, Id>
  readonly scope!: Linkable<S, Scope>
  readonly source?: Source


  constructor(payload: Payload<$Node<S>>) {
    assign(this, payload)
  }

  is<Q extends Kind | Category>(kindOrCategory: Q): this is NodeOfKindOrCategory<Q, S> {
    return this.kind === kindOrCategory
  }

  // TODO: type node-by-node like parent?
  @cached
  children<N extends Node<S> = Node<S>>(): List<N> {
    const extractChildren = (owner: any): List<N> => {
      if (isNode<S>(owner)) return [owner as N]
      if (isArray(owner)) return owner.flatMap(extractChildren)
      if (owner instanceof Object) return values(owner).flatMap(extractChildren)
      return []
    }

    return values(this).flatMap(extractChildren)
  }

  parent<R extends Linked>(this: Module<R> | Describe<R>): Package<R>
  parent<R extends Linked>(this: Field<R> | Method<R>): Module<R>
  parent<R extends Linked>(this: Constructor<R>): Class<R>
  parent<R extends Linked>(this: Node<R>): Node<R>
  @cached
  parent(): never {
    throw new Error(`Missing parent in cache for node ${this.id}`)
  }

  environment<R extends Linked>(this: Node<R>): Environment<R> { throw new Error('Unlinked node has no environment') }

  descendants<Q extends Kind | Category>(this: Node<S>, kindOrCategory?: Q): List<NodeOfKindOrCategory<Q, S>> {
    const pending: Node<S>[] = []
    const response: NodeOfKindOrCategory<Q, S>[] = []
    let next: Node<S> | undefined = this
    do {
      const children = next!.children<NodeOfKindOrCategory<Q, S>>()
      response.push(...kindOrCategory ? children.filter(child => child.is(kindOrCategory)) : children)
      pending.push(...children)
      next = pending.shift()
    } while (next)
    return response
  }

  forEach(
    this: Node<S>,
    tx: ((node: Node<S>, parent?: Node<S>) => void) | Partial<{ [K in Kind]: (node: NodeOfKind<K, S>, parent?: Node<S>) => void }>,
    parent?: Node<S>
  ) {
    if (typeof tx === 'function') tx(this, parent)
    else tx[this.kind]?.(this as any, parent)

    this.children().forEach(child => child.forEach(tx, this))
  }

  transform<R extends S = S>(
    this: Node<S>,
    tx: ((node: Node<S>) => Node<R>) | Partial<{ [K in Kind]: (node: NodeOfKind<K, S>) => NodeOfKind<K, R> }>
  ): NodeOfKind<this['kind'], R> {
    const applyTransform = (value: any): any => {
      if (typeof value === 'function') return value
      if (isArray(value)) return value.map(applyTransform)
      if (isNode<S>(value)) return typeof tx === 'function'
        ? mapObject(applyTransform, tx(value))
        : (tx[value.kind] as any || ((n: any) => n))(mapObject(applyTransform, value))
      if (value instanceof Object) return mapObject(applyTransform, value)
      return value
    }

    return applyTransform(this)
  }

  reduce<T>(this: Node<S>, tx: (acum: T, node: Node<S>) => T, initial: T): T {
    return this.children().reduce((acum, child) => child.reduce(tx, acum), tx(initial, this))
  }

  // TODO: would it be too slow to replace this with ancestors().find?
  closestAncestor<R extends Linked, K extends Kind>(this: Node<R>, kind: K): NodeOfKind<K, R> | undefined {
    let parent: Node<R>
    try {
      parent = this.parent()
    } catch (_) { return undefined }

    return parent.is(kind) ? parent as any : parent.closestAncestor(kind)
  }

}


// ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// COMMON
// ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export class Parameter<S extends Stage = Final> extends $Node<S> {
  readonly kind = 'Parameter'
  readonly name!: Name
  readonly isVarArg!: boolean

  constructor(payload: Payload<Parameter<S>>) { super(payload) }
}


export class NamedArgument<S extends Stage = Final> extends $Node<S> {
  readonly kind = 'NamedArgument'
  readonly name!: Name
  readonly value!: Expression<S>

  constructor(payload: Payload<NamedArgument<S>>) { super(payload) }
}


export class Import<S extends Stage = Final> extends $Node<S> {
  readonly kind = 'Import'
  readonly entity!: Reference<S>
  readonly isGeneric!: boolean

  constructor(payload: Payload<Import<S>>) { super(payload) }
}


export class Body<S extends Stage = Final> extends $Node<S> {
  readonly kind = 'Body'
  readonly sentences!: List<Sentence<S>>

  constructor(payload: Payload<Body<S>>) { super(payload) }
}

// ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// ENTITIES
// ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export type Entity<S extends Stage = Final>
  = Package<S>
  | Program<S>
  | Test<S>
  | Describe<S>
  | Module<S>
  | Variable<S>


abstract class $Entity<S extends Stage> extends $Node<S> {
  abstract readonly name: Name | undefined

  is<Q extends Kind | Category>(kindOrCategory: Q): this is NodeOfKindOrCategory<Q, S> {
    return kindOrCategory === 'Entity' || super.is(kindOrCategory)
  }

  fullyQualifiedName<R extends Linked>(this: Entity<R>): Name {
    const parent = this.parent()
    const label = this.is('Singleton')
      ? this.name || `${this.superCall.superclass.target<Module<R>, R>().fullyQualifiedName()}#${this.id}`
      : this.name.replace(/\.#/g, '')

    return parent.is('Package') || parent.is('Describe')
      ? `${parent.fullyQualifiedName()}.${label}`
      : label
  }
}


export class Package<S extends Stage = Final> extends $Entity<S> {
  readonly kind = 'Package'
  readonly name!: Name
  readonly imports!: List<Import<S>>
  readonly members!: List<Entity<S>>

  constructor(data: Payload<Package<S>>) { super(data) }

  @cached
  getNodeByQN<R extends Linked, N extends Node<R>>(this: Package<R>, qualifiedName: Name): N {
    const [, id] = qualifiedName.split('#')
    if (id) return this.environment().getNodeById(id)
    return qualifiedName.split('.').reduce((current: Node<R>, step) => {
      const next = current.children().find(child => child.is('Entity') && child.name === step)
      if (!next) throw new Error(`Could not resolve reference to ${qualifiedName} from ${this.name}`)
      return next
    }, this) as N
  }

}


export class Program<S extends Stage = Final> extends $Entity<S> {
  readonly kind = 'Program'
  readonly name!: Name
  readonly body!: Body<S>

  constructor(data: Payload<Program<S>>) { super(data) }
}


export class Test<S extends Stage = Final> extends $Entity<S> {
  readonly kind = 'Test'
  readonly name!: Name
  readonly body!: Body<S>

  constructor(data: Payload<Test<S>>) { super(data) }
}


export class Describe<S extends Stage = Final> extends $Entity<S> {
  readonly kind = 'Describe'
  readonly name!: Name
  readonly members!: List<DescribeMember<S>>

  constructor(data: Payload<Describe<S>>) { super(data) }

  tests(): List<Test<S>> { return this.members.filter((member): member is Test<S> => member.is('Test')) }
  methods(): List<Method<S>> { return this.members.filter((member): member is Method<S> => member.is('Method')) }
  variables(): List<Variable<S>> { return this.members.filter((member): member is Variable<S> => member.is('Variable')) }
  fixtures(): List<Fixture<S>> { return this.members.filter((member): member is Fixture<S> => member.is('Fixture')) }

  @cached
  lookupMethod<R extends Linked>(this: Describe<R>, name: Name, arity: number): Method<R> | undefined {
    return this.methods().find(member =>
      (!!member.body || member.isNative) && member.name === name && (
        member.parameters.some(({ isVarArg }) => isVarArg) && member.parameters.length - 1 <= arity ||
        member.parameters.length === arity
      )
    )
  }
}


export class Variable<S extends Stage = Final> extends $Entity<S> {
  readonly kind = 'Variable'
  readonly name!: Name
  readonly isReadOnly!: boolean
  readonly value!: Fillable<S, Expression<S>>

  constructor(data: Payload<Variable<S>>) { super(data) }

  // TODO: Evitar?
  is<Q extends Kind | Category>(kindOrCategory: Q): this is NodeOfKindOrCategory<Q, S> {
    return [this.kind, 'Sentence', 'Entity'].includes(kindOrCategory)
  }
}

// ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// MODULES
// ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export type Module<S extends Stage = Final> = Class<S> | Singleton<S> | Mixin<S>

abstract class $Module<S extends Stage> extends $Entity<S> {
  abstract members: List<ClassMember<S> | DescribeMember<S>>

  is<Q extends Kind | Category>(kindOrCategory: Q): this is NodeOfKindOrCategory<Q, S> {
    return kindOrCategory === 'Module' || super.is(kindOrCategory)
  }

  methods(): List<Method<S>> { return this.members.filter((member): member is Method<S> => member.is('Method')) }

  fields(): List<Field<S>> { return this.members.filter((member): member is Field<S> => member.is('Field')) }

  @cached
  hierarchy<R extends Linked>(this: Module<R>): List<Module<R>> {
    const hierarchyExcluding = (module: Module<R>, exclude: List<Id> = []): List<Module<R>> => {
      if (exclude.includes(module.id!)) return []
      const modules = [
        ...module.mixins.map(mixin => mixin.target<Module<R>, R>()),
        ...module.kind === 'Mixin' ? [] : module.superclassNode() ? [module.superclassNode()!] : [],
      ]
      return modules.reduce(({ mods, exs }, mod) => (
        { mods: [...mods, ...hierarchyExcluding(mod, exs)], exs: [mod.id, ...exs] }
      ), { mods: [module], exs: [module.id, ...exclude] }).mods
    }

    return hierarchyExcluding(this)
  }

  inherits<R extends Linked>(this: Module<R>, other: Module<R>): boolean {
    return this.hierarchy().some(({ id }) => other.id === id)
  }

  @cached
  lookupMethod<R extends Linked>(this: Module<R>, name: Name, arity: number): Method<R> | undefined {
    for (const module of this.hierarchy()) {
      const found = module.methods().find(member => (!!member.body || member.isNative) && member.matchesSignature(name, arity))
      if (found) return found
    }
    return undefined
  }

}


export class Class<S extends Stage = Final> extends $Module<S> {
  readonly kind = 'Class'
  readonly name!: Name
  readonly mixins!: List<Reference<S>>
  readonly members!: List<ClassMember<S>>
  // TODO: rename this and rename superclassNode to superclass (in Singleton too)
  readonly superclass!: Fillable<S, Reference<S> | null>

  constructor(data: Payload<Class<S>>) { super(data) }

  constructors(): List<Constructor<S>> { return this.members.filter<Constructor<S>>((member): member is Constructor<S> => member.is('Constructor')) }

  superclassNode<R extends Linked>(this: Module<R>): Class<R> | null
  superclassNode<R extends Linked>(this: Class<R>): Class<R> | null {
    return this.superclass?.target<Class<R>, R>() ?? null
  }

  @cached
  lookupConstructor<R extends Linked>(this: Class<R>, arity: number): Constructor<R> | undefined {
    const ownConstructor = this.constructors().find(member => member.matchesSignature(arity))

    if (ownConstructor) return ownConstructor

    const isNotDefaultConstructor = (constructor: Constructor<R>) => constructor.body.sentences.length !== 0 || constructor.baseCall
    return this.constructors().filter(isNotDefaultConstructor).length
      ? undefined
      : this.superclassNode?.()?.lookupConstructor?.(arity)
  }
}


export class Singleton<S extends Stage = Final> extends $Module<S> {
  readonly kind = 'Singleton'
  readonly name: Name | undefined
  readonly mixins!: List<Reference<S>>
  readonly members!: List<ObjectMember<S>>
  readonly superCall!: Fillable<S, {
    superclass: Reference<S>,
    args: List<Expression<S>> | List<NamedArgument<S>>
  }>

  constructor(data: Payload<Singleton<S>>) { super(data) }

  superclassNode<R extends Linked>(this: Module<R>): Class<R>
  superclassNode<R extends Linked>(this: Singleton<R>): Class<R> {
    return this.superCall.superclass.target()
  }
}


export class Mixin<S extends Stage = Final> extends $Module<S> {
  readonly kind = 'Mixin'
  readonly name!: Name
  readonly mixins!: List<Reference<S>>
  readonly members!: List<ObjectMember<S>>

  constructor(data: Payload<Mixin<S>>) { super(data) }
}

// ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// MEMBERS
// ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export type ObjectMember<S extends Stage = Final> = Field<S> | Method<S>
export type ClassMember<S extends Stage = Final> = Constructor<S> | ObjectMember<S>
export type DescribeMember<S extends Stage = Final> = Variable<S> | Fixture<S> | Test<S> | Method<S>


export class Field<S extends Stage = Final> extends $Node<S> {
  readonly kind = 'Field'
  readonly name!: Name
  readonly isReadOnly!: boolean
  readonly isProperty!: boolean
  readonly value!: Fillable<S, Expression<S>>

  constructor(data: Payload<Field<S>>) { super(data) }
}


export class Method<S extends Stage = Final> extends $Node<S> {
  readonly kind = 'Method'
  readonly name!: Name
  readonly isOverride!: boolean
  readonly isNative!: boolean // TODO: Represent abstractness and nativeness as body types?
  readonly parameters!: List<Parameter<S>>
  readonly body?: Body<S>

  constructor(data: Payload<Method<S>>) { super(data) }

  matchesSignature(name: Name, arity: number): boolean {
    return this.name === name && (
      this.parameters.some(({ isVarArg }) => isVarArg) && this.parameters.length - 1 <= arity ||
      this.parameters.length === arity
    )
  }

}

export class Constructor<S extends Stage = Final> extends $Node<S> {
  readonly kind = 'Constructor'
  readonly parameters!: List<Parameter<S>>
  readonly body!: Body<S>
  readonly baseCall?: { callsSuper: boolean, args: List<Expression<S>> }

  constructor(data: Payload<Constructor<S>>) { super(data) }

  matchesSignature<R extends Linked>(this: Constructor<R>, arity: number): boolean {
    return this.parameters.some(({ isVarArg }) => isVarArg) && this.parameters.length - 1 <= arity ||
      this.parameters.length === arity
  }
}


export class Fixture<S extends Stage = Final> extends $Node<S> {
  readonly kind = 'Fixture'
  readonly body!: Body<S>

  constructor(data: Payload<Fixture<S>>) { super(data) }
}

// ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// SENTENCES
// ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export type Sentence<S extends Stage = Final> = Variable<S> | Return<S> | Assignment<S> | Expression<S>


abstract class $Sentence<S extends Stage> extends $Node<S> {
  is<Q extends Kind | Category>(kindOrCategory: Q): this is NodeOfKindOrCategory<Q, S> {
    return kindOrCategory === 'Sentence' || super.is(kindOrCategory)
  }
}


export class Return<S extends Stage = Final> extends $Sentence<S> {
  readonly kind = 'Return'
  readonly value?: Expression<S>

  constructor(data: Payload<Return<S>>) { super(data) }
}


export class Assignment<S extends Stage = Final> extends $Sentence<S> {
  readonly kind = 'Assignment'
  readonly variable!: Reference<S>
  readonly value!: Expression<S>

  constructor(data: Payload<Assignment<S>>) { super(data) }
}

// ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// EXPRESSIONS
// ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export type Expression<S extends Stage = Final>
  = Reference<S>
  | Self<S>
  | Literal<S, LiteralValue<S>>
  | Send<S>
  | Super<S>
  | New<S>
  | If<S>
  | Throw<S>
  | Try<S>

abstract class $Expression<S extends Stage> extends $Node<S> {
  is<Q extends Kind | Category>(kindOrCategory: Q): this is NodeOfKindOrCategory<Q, S> {
    return kindOrCategory === 'Expression' || super.is(kindOrCategory)
  }
}


export class Reference<S extends Stage = Final> extends $Expression<S> {
  readonly kind = 'Reference'
  readonly name!: Name

  constructor(data: Payload<Reference<S>>) { super(data) }

  @cached
  target<N extends Node<C>, C extends Linked>(this: Reference<C>): N {
    const [start, rest] = divideOn('.')(this.name)
    const root: Package<C> = this.environment().getNodeById(this.scope[start])
    return rest.length ? root.getNodeByQN(rest) : root as N
  }

}


export class Self<S extends Stage = Final> extends $Expression<S> {
  readonly kind = 'Self'

  constructor(data: Payload<Self<S>>) { super(data) }
}


export type LiteralValue<S extends Stage = Final> = number | string | boolean | null | New<S> | Singleton<S>
export class Literal<S extends Stage = Final, T extends LiteralValue<S> = LiteralValue<S>> extends $Expression<S> {
  readonly kind = 'Literal'
  readonly value!: T

  constructor(data: Payload<Literal<S, T>>) { super(data) }
}


export class Send<S extends Stage = Final> extends $Expression<S> {
  readonly kind = 'Send'
  readonly receiver!: Expression<S>
  readonly message!: Name
  readonly args!: List<Expression<S>>

  constructor(data: Payload<Send<S>>) { super(data) }
}


export class Super<S extends Stage = Final> extends $Expression<S> {
  readonly kind = 'Super'
  readonly args!: List<Expression<S>>

  constructor(data: Payload<Super<S>>) { super(data) }
}


export class New<S extends Stage = Final> extends $Expression<S> {
  readonly kind = 'New'
  readonly instantiated!: Reference<S>
  readonly args!: List<Expression<S>> | List<NamedArgument<S>>

  constructor(data: Payload<New<S>>) { super(data) }
}


export class If<S extends Stage = Final> extends $Expression<S> {
  readonly kind = 'If'
  readonly condition!: Expression<S>
  readonly thenBody!: Body<S>
  readonly elseBody!: Fillable<S, Body<S>>

  constructor(data: Payload<If<S>>) { super(data) }
}


export class Throw<S extends Stage = Final> extends $Expression<S> {
  readonly kind = 'Throw'
  readonly exception!: Expression<S>

  constructor(data: Payload<Throw<S>>) { super(data) }
}


export class Try<S extends Stage = Final> extends $Expression<S> {
  readonly kind = 'Try'
  readonly body!: Body<S>
  readonly catches!: List<Catch<S>>
  readonly always!: Fillable<S, Body<S>>

  constructor(data: Payload<Try<S>>) { super(data) }
}


export class Catch<S extends Stage = Final> extends $Expression<S> {
  readonly kind = 'Catch'
  readonly parameter!: Parameter<S>
  readonly body!: Body<S>
  readonly parameterType!: Fillable<S, Reference<S>>

  constructor(data: Payload<Catch<S>>) { super(data) }
}


// ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// SYNTHETICS
// ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export class Environment<S extends Stage = Final> extends $Node<S> {
  readonly kind = 'Environment'
  readonly members!: Linkable<S, List<Package<S>>>

  constructor(data: Payload<Environment<S>>) { super(data) }

  @cached
  getNodeById<R extends Linked, N extends Node<R>>(this: Environment<R>, _id: Id): N {
    throw new Error(`Missing node in node cache with id ${_id}`)
  }

  @cached
  getNodeByFQN<R extends Linked, N extends Node<R>>(this: Environment<R>, fullyQualifiedName: Name): N {
    const [start, rest] = divideOn('.')(fullyQualifiedName)
    const root = this.children<Package<R>>().find(child => child.name === start)
    if (!root) throw new Error(`Could not resolve reference to ${fullyQualifiedName}`)
    return rest ? root.getNodeByQN(rest) : root as N
  }

}


// TODO:  CLASSES FIXES
//   - target type parameters (?)
//   - Avoid casting on is() calls and fix implementation
//   - Mixin-pattern for abstract classes to fix Variable case