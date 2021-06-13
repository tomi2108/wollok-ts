Before a *Wollok* program can be executed, the text on it's sources needs to be processed into a more useful structure and checked for possible problems. This is done through a series of steps we call the **Language Pipeline**. Each step is modeled as a function that receives the output of the previous one and returns a more refined representation of the program.

On this section we will address a general description of each step. For a more in-depth explanation on each of them, follow the links to the corresponding wiki pages.

![Pipeline](https://drive.google.com/uc?authuser=0&id=1ruqzhAAsIbbnEfH8tNoFYfHHk-2Yp0ZQ&export=download)

### [[Parser]]

The **[[Parser]]** is the first step of the pipeline. It takes **Wollok Code** and builds an **Abstract Syntax Tree** based on its content. Different parsers are provided, designed to parse specific *Wollok* abstractions, such as a single expression or a whole source file.

### [[Linker]]

The **[[Linker]]** takes multiple isolated **AST**s and connects them together to form a **Linked Environment**. During this process it also assigns each node with a unique id and generates the **Visibility Scope** for it, used to identify what node is each reference targeting and ensure there are no missing definitions.

### [[Validator]]

The **[[Validator]]** checks a **Linked Environment** searching for possible issues that the previous steps are unable to detect and returns a **List of Problems**. If this list is empty the environment can be considered a **Valid Linked Environment** and thus, ready to be interpreted or used for refactors and code analysis routines.

### [[Interpreter]]

An **[[Interpreter]]** is one of the possible final steps of the pipeline. It takes a **Valid Linked Environment** and some **Primitive Implementations** for *native methods* and produces an **Evaluation** that can be executed step by step and inspected as part of a *debug process* or simply run until it ends. This include executing a **Program**, running **Tests** or interacting with a **REPL**.