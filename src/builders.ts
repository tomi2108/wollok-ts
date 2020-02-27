import { Evaluation as EvaluationBehavior, Frame as FrameBehavior } from './behavior'
import { mapObject } from './extensions'
import { Context, Evaluation as EvaluationType, Frame as FrameType, RuntimeObject as RuntimeObjectType } from './interpreter'
import * as Model from './model'
import { Assignment as AssignmentNode, Body as BodyNode, Catch as CatchNode, Class as ClassNode, ClassMember, Constructor as ConstructorNode, Describe as DescribeNode, DescribeMember, Entity, Environment as EnvironmentNode, Expression, Field as FieldNode, Filled, Fixture as FixtureNode, Id, If as IfNode, Import as ImportNode, isNode, Linked, List, Literal as LiteralNode, LiteralValue, Method as MethodNode, Mixin as MixinNode, Name, NamedArgument as NamedArgumentNode, New as NewNode, Node, ObjectMember, Package as PackageNode, Parameter as ParameterNode, Payload, Program as ProgramNode, Raw, Reference as ReferenceNode, Return as ReturnNode, Self as SelfNode, Send as SendNode, Sentence, Singleton as SingletonNode, Super as SuperNode, Test as TestNode, Throw as ThrowNode, Try as TryNode, Variable as VariableNode } from './model'

const { isArray } = Array

type BuildPayload<T> = Partial<Payload<T>>

// ══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// NODES
// ══════════════════════════════════════════════════════════════════════════════════════════════════════════════════

export function asNode<N extends Node<Raw>>(payload: Payload<N> & Pick<N, 'kind'>): N {
  const constructor: new (payload: Payload<N>) => N = Model[payload.kind] as any
  return new constructor(payload)
}

export function fromJSON<T>(json: any): T {
  const propagate = (data: any) => {
    if (isNode(data)) return asNode(mapObject(fromJSON, data) as any)
    if (isArray(data)) return data.map(fromJSON)
    if (data instanceof Object) return mapObject(fromJSON, data)
    return data
  }
  return propagate(json) as T
}

// ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// COMMON
// ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export const Reference = (name: Name) => new ReferenceNode<Raw>({ name })

export const Parameter = (name: Name, payload?: BuildPayload<ParameterNode<Raw>>) => new ParameterNode<Raw>({
  name,
  isVarArg: false,
  ...payload,
})

export const NamedArgument = (name: Name, value: Expression<Raw>) => new NamedArgumentNode<Raw>({
  name,
  value,
})

export const Import = (reference: ReferenceNode<Raw>, payload?: BuildPayload<ImportNode<Raw>>) => new ImportNode<Raw>({
  entity: reference,
  isGeneric: false,
  ...payload,
})

export const Body = (...sentences: Sentence<Raw>[]) => new BodyNode<Raw>({ sentences })

// ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// ENTITIES
// ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export const Package = (name: Name, payload?: BuildPayload<PackageNode<Raw>>) =>
  (...members: Entity<Raw>[]) => new PackageNode<Raw>({
    name,
    imports: [],
    ...payload,
    members,
  })


export const Class = (name: Name, payload?: BuildPayload<ClassNode<Raw>>) =>
  (...members: ClassMember<Raw>[]) =>
    new ClassNode<Raw>({
      name,
      members,
      mixins: [],
      ...payload,
    })

export const Singleton = (name?: Name, payload?: BuildPayload<SingletonNode<Raw>>) =>
  (...members: ObjectMember<Raw>[]) =>
    new SingletonNode<Raw>({
      members,
      mixins: [],
      ...name ? { name } : {},
      ...payload,
    })

export const Mixin = (name: Name, payload?: BuildPayload<MixinNode<Raw>>) =>
  (...members: ObjectMember<Raw>[]) =>
    new MixinNode<Raw>({
      name,
      members,
      mixins: [],
      ...payload,
    })

export const Program = (name: Name, payload?: BuildPayload<ProgramNode<Raw>>) =>
  (...sentences: Sentence<Raw>[]) =>
    new ProgramNode<Raw>({
      name,
      body: Body(...sentences),
      ...payload,
    })

export const Test = (name: string, payload?: BuildPayload<TestNode<Raw>>) =>
  (...sentences: Sentence<Raw>[]) =>
    new TestNode<Raw>({
      name,
      body: Body(...sentences),
      ...payload,
    })

export const Describe = (name: string, payload?: BuildPayload<DescribeNode<Raw>>) =>
  (...members: DescribeMember<Raw>[]) =>
    new DescribeNode<Raw>({
      name,
      members,
      ...payload,
    })

// ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// MEMBERS
// ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export const Field = (name: Name, payload?: BuildPayload<FieldNode<Raw>>) => new FieldNode<Raw>({
  name,
  isReadOnly: false,
  isProperty: false,
  ...payload,
})

export const Method = (name: Name, payload?: BuildPayload<MethodNode<Raw>>) =>
  (...sentences: Sentence<Raw>[]) => {
    const { body, ...otherPayload } = payload || { body: undefined }

    return new MethodNode<Raw>({
      name,
      isOverride: false,
      isNative: false,
      parameters: [],
      ...payload && 'body' in payload && body === undefined ? {} : {
        body: body || Body(...sentences),
      },
      ...otherPayload,
    })
  }

export const Constructor = (payload?: BuildPayload<ConstructorNode<Raw>>) =>
  (...sentences: Sentence<Raw>[]) => new ConstructorNode<Raw>({
    body: Body(...sentences),
    parameters: [],
    ...payload,
  })

export const Fixture = (_?: BuildPayload<FixtureNode<Raw>>) =>
  (...sentences: Sentence<Raw>[]) =>
    new FixtureNode<Raw>({
      body: Body(...sentences),
    })

// ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// SENTENCES
// ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export const Variable = (name: Name, payload?: BuildPayload<VariableNode<Raw>>) => new VariableNode<Raw>({
  name,
  isReadOnly: false,
  ...payload,
})

export const Return = (value: Expression<Raw> | undefined = undefined) => new ReturnNode<Raw>({ value })

export const Assignment = (reference: ReferenceNode<Raw>, value: Expression<Raw>) =>
  new AssignmentNode<Raw>({ variable: reference, value })

// ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// EXPRESSIONS
// ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export const Self = () => new SelfNode<Raw>({})

export const Literal = (value: LiteralValue<Raw>) => new LiteralNode<Raw, LiteralValue<Raw>>({ value })

export const Send = (receiver: Expression<Raw>, message: Name, args: List<Expression<Raw>> = [], payload?: BuildPayload<SendNode<Raw>>) =>
  new SendNode<Raw>({
    receiver,
    message,
    args,
    ...payload,
  })

export const Super = (args: List<Expression<Raw>> = []) => new SuperNode<Raw>({ args })

export const New = (className: ReferenceNode<Raw>, args: List<Expression<Raw>> | List<NamedArgumentNode<Raw>>) =>
  new NewNode<Raw>({ instantiated: className, args })

export const If = (condition: Expression<Raw>, thenBody: List<Sentence<Raw>>, elseBody?: List<Sentence<Raw>>) => new IfNode<Raw>({
  condition,
  thenBody: Body(...thenBody),
  elseBody: elseBody && Body(...elseBody),
})

export const Throw = (arg: Expression<Raw>) => new ThrowNode<Raw>({ exception: arg })

export const Try = (sentences: List<Sentence<Raw>>, payload: {
  catches?: List<CatchNode<Raw>>,
  always?: List<Sentence<Raw>>
}) =>
  new TryNode<Raw>({
    body: Body(...sentences),
    catches: payload.catches || [],
    always: payload.always && Body(...payload.always),
  })

export const Catch = (parameter: ParameterNode<Raw>, payload?: BuildPayload<CatchNode<Raw>>) =>
  (...sentences: Sentence<Raw>[]) =>
    new CatchNode<Raw>({
      body: Body(...sentences),
      parameter,
      ...payload,
    })

// ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// SYNTHETICS
// ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export const Closure = (toString?: string, ...parameters: ParameterNode<Raw>[]) =>
  (...sentences: Sentence<Raw>[]): LiteralNode<Raw, SingletonNode<Raw>> =>
    new LiteralNode({
      value: new SingletonNode({
        superCall: { superclass: new ReferenceNode({ name: 'wollok.lang.Closure' }), args: [] },
        mixins: [],
        members: [
          new MethodNode({
            name: '<apply>',
            isOverride: false,
            isNative: false,
            parameters,
            body: new BodyNode({ sentences }),
          }),
          ...toString ? [new FieldNode<Raw>({
            name: '<toString>',
            isReadOnly: true,
            isProperty: false,
            value: new LiteralNode({ value: toString }),
          })] : [],
        ],
      }),
    })


export const Environment = (...members: PackageNode<Linked>[]): EnvironmentNode<Linked> => {
  return new EnvironmentNode<Linked>({ members, id: '', scope: {} })
}

// ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// UTILS
// ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export const getter = (name: Name): MethodNode<Filled> => new MethodNode({
  name,
  isNative: false,
  isOverride: false,
  parameters: [],
  body: new BodyNode({
    sentences: [
      new ReturnNode({
        value: new ReferenceNode({ name }),
      }),
    ],
  }),
})

export const setter = (name: Name): MethodNode<Filled> => new MethodNode({
  name,
  isNative: false,
  isOverride: false,
  parameters: [new ParameterNode({ name: '<value>', isVarArg: false })],
  body: new BodyNode({
    sentences: [
      new AssignmentNode({
        variable: new ReferenceNode({ name }),
        value: new ReferenceNode({ name: '<value>' }),
      }),
    ],
  }),
})


// ══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// EVALUATION
// ══════════════════════════════════════════════════════════════════════════════════════════════════════════════════

export const Evaluation = (
  environment: EnvironmentNode,
  instances: Record<Id, RuntimeObjectType> = {},
  contexts: Record<Id, Context> = {}
) =>
  (...frameStack: FrameType[]): EvaluationType => EvaluationBehavior({
    environment,
    instances,
    contexts,
    frameStack: [...frameStack].reverse(),
  })

export const Frame = (payload: Partial<FrameType>): FrameType => FrameBehavior({
  nextInstruction: 0,
  instructions: [],
  operandStack: [],
  ...payload,
})

export const RuntimeObject = (id: Id, moduleFQN: Name, innerValue?: string | number | boolean | Id[]): RuntimeObjectType =>
  ({
    id,
    moduleFQN,
    innerValue,
  } as RuntimeObjectType)