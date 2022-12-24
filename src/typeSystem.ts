import { last, List } from "./extensions"
import { Assignment, Body, Class, Closure, Environment, Expression, Field, If, is, Literal, Method, Module, Name, New, Node, Package, Program, Reference, Return, Self, Send, Super, Variable } from "./model"

type WollokType = WollokAtomicType | WollokModuleType | WollokUnionType
type AtomicType = typeof ANY | typeof VOID

class WollokAtomicType {
    id: AtomicType

    constructor(id: AtomicType) {
        this.id = id
    }

    lookupMethod(name: Name, arity: number, options?: { lookupStartFQN?: Name, allowAbstractMethods?: boolean }) {
        throw "Atomic types has no methods"
    }

    atParam(name: string): TypeVariable {
        throw "Atomic types has no params"!
    }

    contains(type: WollokType): boolean {
        return type instanceof WollokAtomicType && this.id === type.id
    }

    asList() { return [this] }

    get name(): string {
        return this.id
    }
}


class WollokModuleType {
    module: Module

    constructor(module: Module) {
        this.module = module
    }

    lookupMethod(name: Name, arity: number, options?: { lookupStartFQN?: Name, allowAbstractMethods?: boolean }) {
        return this.module.lookupMethod(name, arity, options)
    }

    contains(type: WollokType): boolean {
        return type instanceof WollokModuleType && this.module === type.module
    }

    atParam(name: string): TypeVariable { throw "Module types has no params"! }

    asList() { return [this] }

    get name(): string {
        return this.module.name!
    }

    toString() { return this.module.toString() }
}

class WollokParametricType extends WollokModuleType {
    params: Map<String, TypeVariable>

    constructor(base: Module, params: Record<string, TypeVariable>) {
        super(base)
        this.params = new Map(Object.entries(params))
    }

    contains(type: WollokType): boolean {
        throw "HALT"
    }

    atParam(name: string): TypeVariable { return this.params.get(name)! }

    get name(): string {
        const innerTypes = [...this.params.values()].map(_ => _.type().name).join(', ')
        return `${super.name}<${innerTypes}>`
    }
}

class WollokMethodType extends WollokParametricType {
    constructor(returnVar: TypeVariable, params: TypeVariable[]) {
        // TODO: Mejorar esta herencia
        super(null as any, {
            ...Object.fromEntries(params.map((p, i) => [`${PARAM}${i}`, p])),
            [RETURN]: returnVar
        })
    }

    get name(): string {
        const params = [...this.params.entries()]
            .filter(([name, _]) => name !== RETURN)
            .map(([_, tVar]) => tVar.type().name)
            .join(', ')
        const returnType = this.atParam(RETURN).type().name
        return `(${params}) => ${returnType}`
    }
}

class WollokUnionType {
    types: WollokType[]

    constructor(types: WollokType[]) {
        this.types = types
    }

    lookupMethod(name: Name, arity: number, options?: { lookupStartFQN?: Name, allowAbstractMethods?: boolean }) {
        throw "Halt"
    }

    atParam(name: string): TypeVariable { throw "Union types has no params"! }

    contains(type: WollokType): boolean {
        if (type instanceof WollokUnionType)
            throw "Halt"
        return this.types.some(_ => _.contains(type))
    }

    asList() { return this.types }

    get name(): string {
        return `(${this.types.map(_ => _.name).join(' | ')})`
    }
}

const ANY = 'ANY'
const VOID = 'VOID'
const ELEMENT = 'ELEMENT'
const RETURN = 'RETURN'
const PARAM = 'PARAM'
const tVars = new Map<Node, TypeVariable>()
let environment: Environment
let globalChange: boolean

// ══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// INTERFACE
// ══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
export function infer(env: Environment) {
    environment = env
    createTypeVariables(env)
    globalChange = true
    while (globalChange) {
        globalChange = [propagateTypes, bindMessages, maxTypesFromMessages].some(f => f())
    }
}

export function getType(node: Node) {
    return typeVariableFor(node).type().name
}

// ══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// TYPE VARIABLES
// ══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
export function typeVariableFor(node: Node) {
    const tVar = tVars.get(node)
    if (!tVar) return newTVarFor(node)
    return tVar
}

function newTVarFor(node: Node) {
    const newTVar = new TypeVariable(node)
    tVars.set(node, newTVar)
    if (node.is('Method')) {
        const parameters = node.parameters.map(p => createTypeVariables(p)!)
        newTVar.setType(new WollokMethodType(newSynteticTVar(), parameters))
    }
    return newTVar
}

function newSynteticTVar() {
    return newTVarFor(Closure({ code: 'Param type' })).beSyntetic() // Using new closure as syntetic node. Is good enough?
}

function createTypeVariables(node: Node) {
    return node.match<TypeVariable | void>({
        Environment: inferEnvironment,
        Package: inferPackage,
        Import: skip,
        Program: inferProgram,
        Body: inferBody,
        Module: inferModule,

        Send: inferSend,
        Method: inferMethod,
        Parameter: inferParameter,

        Return: inferReturn,
        If: inferIf,
        Assignment: inferAssignment,
        Throw: typeVariableFor, //TODO
        Try: typeVariableFor, //TODO

        New: inferNew,
        NamedArgument: typeVariableFor, //TODO

        Variable: inferVariable,
        Field: inferVariable,
        Reference: inferReference,

        Literal: inferLiteral,
        Self: inferSelf,
        Super: inferSelf,
    })
}

const inferEnvironment = (env: Environment) => {
    env.children().forEach(createTypeVariables)
}

const inferPackage = (p: Package) => {
    if (p.name.startsWith('wollok')) return; //TODO: Fix wrong inferences
    p.children().forEach(createTypeVariables)
}

const inferProgram = (p: Program) => {
    createTypeVariables(p.body)
}

const inferBody = (body: Body) => {
    body.sentences.forEach(createTypeVariables)
}

const inferModule = (m: Module) => {
    m.members.forEach(createTypeVariables)
    typeVariableFor(m)
}

const inferNew = (n: New) => {
    const args = n.args.map(createTypeVariables)
    const clazz = n.instantiated.target()!
    return typeVariableFor(n).setType(new WollokModuleType(clazz))
}

const inferMethod = (m: Method) => {
    const method = typeVariableFor(m)
    m.sentences().forEach(createTypeVariables)

    const typeAnnotation = m.metadata.find(_ => _.name === 'Type')
    if (typeAnnotation) {
        const typeRef = typeAnnotation.args['returnType'] as string
        method.atParam(RETURN).setType(new WollokModuleType(environment.getNodeByFQN<Module>(typeRef)))
    }
    return method
}

const inferSend = (send: Send) => {
    const receiver = createTypeVariables(send.receiver)!
    const args = send.args.map(createTypeVariables)
    receiver.addSend(send)
    return typeVariableFor(send)
}

const inferAssignment = (a: Assignment) => {
    const variable = createTypeVariables(a.variable)!
    const value = createTypeVariables(a.value)!
    variable.isSupertypeOf(value)
    return typeVariableFor(a).setType(new WollokAtomicType(VOID))
}

const inferVariable = (v: Variable | Field) => {
    const valueTVar = createTypeVariables(v.value)
    const varTVar = typeVariableFor(v)
    if (valueTVar) varTVar.isSupertypeOf(valueTVar)
    return varTVar
}

const inferParameter = (p: Node) => {
    return typeVariableFor(p) //TODO: Close min types?
}

const inferReturn = (r: Return) => {
    const method = r.ancestors().find(is('Method'))
    if (!method) throw 'Method for Return not found'
    if (r.value)
        typeVariableFor(method).atParam(RETURN).isSupertypeOf(createTypeVariables(r.value)!)
    else
        typeVariableFor(method).atParam(RETURN).setType(new WollokAtomicType(VOID))
    return typeVariableFor(r).setType(new WollokAtomicType(VOID))
}

const inferIf = (_if: If) => {
    createTypeVariables(_if.condition)!.hasType(new WollokModuleType(environment.booleanClass))
    createTypeVariables(_if.thenBody)
    createTypeVariables(_if.elseBody)
    return typeVariableFor(_if) // TODO: diferenciar if-expression? Cómo?
        .isSupertypeOf(typeVariableFor(last(_if.thenBody.sentences)!))
        .isSupertypeOf(typeVariableFor(last(_if.elseBody.sentences)!))
}

const inferReference = (r: Reference<Node>) => {
    const varTVar = typeVariableFor(r.target()!)! // Variable already visited
    const referenceTVar = typeVariableFor(r)
    referenceTVar.isSupertypeOf(varTVar)
    return referenceTVar
}

const inferSelf = (self: Self | Super) => {
    const module = self.ancestors().find<Module>((node: Node): node is Module =>
        node.is('Module') && !node.fullyQualifiedName().startsWith('wollok.lang.Closure')) // Ignore closures
    if (!module) throw 'Module for Self not found'
    return typeVariableFor(self).setType(new WollokModuleType(module))
}

const inferLiteral = (l: Literal) => {
    const tVar = typeVariableFor(l)
    const { numberClass, stringClass, booleanClass } = environment
    switch (typeof l.value) {
        case "number": return tVar.setType(new WollokModuleType(numberClass))
        case "string": return tVar.setType(new WollokModuleType(stringClass))
        case "boolean": return tVar.setType(new WollokModuleType(booleanClass))
        case "object":
            if (Array.isArray(l.value)) return tVar.setType(arrayLiteralType(l.value))
            if (l.value === null) return tVar //tVar.setType('Null')
        default: throw "Literal type not found"
    }
}

const arrayLiteralType = (value: readonly [Reference<Class>, List<Expression>]) => {
    const elementTVar = typeVariableFor(value[0]) // TODO: Use syntetic node?
    value[1].map(createTypeVariables).forEach(inner =>
        elementTVar.isSupertypeOf(inner!)
    )
    return new WollokParametricType(value[0].target()!, { [ELEMENT]: elementTVar })
}


const skip = (_: Node) => { }


class TypeVariable {
    typeInfo: TypeInfo = new TypeInfo()
    subtypes: TypeVariable[] = []
    supertypes: TypeVariable[] = []
    messages: Send[] = []
    syntetic: boolean = false
    node: Node

    constructor(node: Node) { this.node = node }


    type() { return this.typeInfo.type() }
    atParam(name: string): TypeVariable { return this.type().atParam(name)! }

    hasAnyType() { return this.type().contains(new WollokAtomicType(ANY)) }
    hasType(type: WollokType) { return this.allPossibleTypes().some(minType => minType.contains(type)) }

    setType(type: WollokType) {
        this.typeInfo.setType(type)
        return this
    }

    addMinType(type: WollokType) {
        this.typeInfo.addMinType(type)
    }

    addMaxType(type: WollokType) {
        this.typeInfo.addMaxType(type)
    }

    isSubtypeOf(tVar: TypeVariable) {
        this.addSupertype(tVar)
        tVar.addSubtype(this)
        return this
    }

    isSupertypeOf(tVar: TypeVariable) {
        this.addSubtype(tVar)
        tVar.addSupertype(this)
        return this
    }

    hasSubtype(tVar: TypeVariable) {
        return this.subtypes.includes(tVar)
    }

    hasSupertype(tVar: TypeVariable) {
        return this.supertypes.includes(tVar)
    }

    addSend(send: Send) {
        this.messages.push(send)
    }

    allMinTypes() {
        return this.typeInfo.minTypes
    }
    allMaxTypes() {
        return this.typeInfo.maxTypes
    }
    allPossibleTypes() {
        return [...this.allMinTypes(), ...this.allMaxTypes()]
    }

    addSubtype(tVar: TypeVariable) {
        this.subtypes.push(tVar)
    }

    addSupertype(tVar: TypeVariable) {
        this.supertypes.push(tVar)
    }

    beSyntetic() {
        this.syntetic = true
        return this
    }

    toString() { return `TVar(${this.syntetic ? 'SYNTEC' : this.node})` }
}

class TypeInfo {
    minTypes: WollokType[] = []
    maxTypes: WollokType[] = []
    final: boolean = false

    type() {
        if (this.maxTypes.length + this.minTypes.length == 0) return new WollokAtomicType(ANY)
        if (this.maxTypes.length == 1) return this.maxTypes[0]
        if (this.minTypes.length == 1) return this.minTypes[0]

        if (this.minTypes.length > 1) return new WollokUnionType(this.minTypes)
        if (this.maxTypes.length > 1) return new WollokUnionType(this.maxTypes)
        throw "Halt"
    }

    setType(type: WollokType) {
        this.addMinType(type)
        this.final = true
    }

    addMinType(type: WollokType) {
        if (this.maxTypes.some(maxType => maxType.contains(type))) return;
        if (this.minTypes.some(minType => minType.contains(type))) return;
        if (this.final)
            throw "Variable inference finalized"
        this.minTypes.push(type)
    }

    addMaxType(type: WollokType) {
        if (this.maxTypes.some(maxType => maxType.contains(type))) return;
        if (this.minTypes.some(minType => minType.contains(type))) return; // TODO: Check min/max types compatibility
        if (this.final)
            throw "Variable inference finalized"
        this.maxTypes.push(type)
    }
}

// ══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// PROPAGATIONS
// ══════════════════════════════════════════════════════════════════════════════════════════════════════════════════

function propagateTypes() {
    return [...tVars.values()].some(tVar => propagateMinTypes(tVar) || propagateMaxTypes(tVar))
}

const propagateMinTypes = (tVar: TypeVariable) => {
    var changed = false
    tVar.allMinTypes().forEach(type => {
        tVar.supertypes.forEach(superTVar => {
            if (!superTVar.hasType(type)) {
                superTVar.addMinType(type)
                console.log(`PROPAGATE MIN TYPE (${type}) FROM |${tVar}| TO |${superTVar}|`)
                changed = true
            }
        })
    })
    return changed
}
const propagateMaxTypes = (tVar: TypeVariable) => {
    var changed = false
    tVar.allMaxTypes().forEach(type => {
        tVar.subtypes.forEach(superTVar => {
            if (!superTVar.hasType(type)) {
                superTVar.addMaxType(type)
                console.log(`PROPAGATE MAX TYPE (${type}) FROM |${tVar}| TO |${superTVar}|`)
                changed = true
            }
        })
    })
    return changed
}

// ══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// MESSAGE BINDING
// ══════════════════════════════════════════════════════════════════════════════════════════════════════════════════

function bindMessages() {
    return [...tVars.values()].some(bindReceivedMessages)
}

const bindReceivedMessages = (tVar: TypeVariable) => {
    if (!tVar.messages.length) return false
    if (tVar.hasAnyType()) return false
    const types = tVar.type().asList()
    var changed = false
    types.forEach(type => {
        tVar.messages.forEach(send => {
            const method = type.lookupMethod(send.message, send.args.length, { allowAbstractMethods: true })
            if (!method) throw `Method ${send.message}/${send.args.length} not found for type ${type}`

            if (!typeVariableFor(method).atParam(RETURN).hasSupertype(typeVariableFor(send))) {
                typeVariableFor(method).atParam(RETURN).addSupertype(typeVariableFor(send))
                console.log(`BIND MESSAGE |${send}| WITH METHOD |${method}|`)
                changed = true
            }
        })
    })
    return changed
}

// ══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// TYPE FROM MESSAGES
// ══════════════════════════════════════════════════════════════════════════════════════════════════════════════════

function maxTypesFromMessages() {
    return [...tVars.values()].some(maxTypeFromMessages)
}

const maxTypeFromMessages = (tVar: TypeVariable) => {
    if (!tVar.messages.length) return false
    if (tVar.allMinTypes().length) return false //TODO: Check compatibility between min and max types
    var changed = false
    environment.descendants()
        .filter(is('Module'))
        .filter(module => tVar.messages.every(send =>
            module.lookupMethod(send.message, send.args.length, { allowAbstractMethods: true })
            // TODO: check params (and return?) types
        ))
        .map(_ => new WollokModuleType(_))
        .forEach(type => {
            if (!tVar.hasType(type)) {
                tVar.addMaxType(type)
                console.log(`NEW MAX TYPE |${type}| FOR |${tVar.node}|`)
                changed = true
            }
        })
    return changed
}