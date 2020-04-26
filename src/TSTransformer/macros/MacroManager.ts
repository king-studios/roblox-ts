import fs from "fs-extra";
import path from "path";
import { ProjectError } from "Shared/errors/ProjectError";
import { CALL_MACROS } from "TSTransformer/macros/callMacros";
import { CONSTRUCTOR_MACROS } from "TSTransformer/macros/constructorMacros";
import { IDENTIFIER_MACROS } from "TSTransformer/macros/identifierMacros";
import { PROPERTY_CALL_MACROS } from "TSTransformer/macros/propertyCallMacros";
import { CallMacro, ConstructorMacro, IdentifierMacro, PropertyCallMacro } from "TSTransformer/macros/types";
import ts from "typescript";

const INCLUDE_FILES = ["roblox.d.ts", "es.d.ts", "macro_math.d.ts"];

interface InterfaceInfo {
	symbols: Array<ts.Symbol>;
	constructors: Array<ts.Symbol>;
	methods: Map<string, Array<ts.Symbol>>;
}

function getOrDefault<K, V>(map: Map<K, V>, key: K, getDefaultValue: () => V) {
	let value = map.get(key);
	if (!value) {
		value = getDefaultValue();
		map.set(key, value);
	}
	return value;
}

export class MacroManager {
	private identifierMacros = new Map<ts.Symbol, IdentifierMacro>();
	private callMacros = new Map<ts.Symbol, CallMacro>();
	private constructorMacros = new Map<ts.Symbol, ConstructorMacro>();
	private propertyCallMacros = new Map<ts.Symbol, PropertyCallMacro>();

	constructor(program: ts.Program, typeChecker: ts.TypeChecker, nodeModulesPath: string) {
		const identifiers = new Map<string, Array<ts.Symbol>>();
		const functions = new Map<string, Array<ts.Symbol>>();
		const interfaces = new Map<string, InterfaceInfo>();

		const typesPath = path.join(nodeModulesPath, "@rbxts", "types", "include");
		for (const fileName of INCLUDE_FILES) {
			const filePath = path.join(typesPath, fileName);
			if (!fs.pathExistsSync(filePath)) {
				throw new ProjectError(`(MacroManager) Path does not exist ${filePath}`);
			}

			const sourceFile = program.getSourceFileByPath(filePath as ts.Path);
			if (!sourceFile) {
				throw new ProjectError(`(MacroManager) Could not find source file for ${filePath}`);
			}

			for (const statement of sourceFile.statements) {
				if (ts.isVariableStatement(statement)) {
					for (const declaration of statement.declarationList.declarations) {
						if (ts.isIdentifier(declaration.name)) {
							const identifierName = declaration.name.text;
							const identifierSymbols = getOrDefault(
								identifiers,
								identifierName,
								() => new Array<ts.Symbol>(),
							);
							identifierSymbols.push(declaration.symbol);
						}
					}
				} else if (ts.isFunctionDeclaration(statement)) {
					const functionSymbols = getOrDefault(functions, statement.name!.text, () => new Array<ts.Symbol>());
					functionSymbols.push(typeChecker.getTypeAtLocation(statement).symbol);
				} else if (ts.isInterfaceDeclaration(statement)) {
					const interfaceInfo = getOrDefault(interfaces, statement.name.text, () => ({
						symbols: new Array<ts.Symbol>(),
						constructors: new Array<ts.Symbol>(),
						methods: new Map<string, Array<ts.Symbol>>(),
					}));

					interfaceInfo.symbols.push(typeChecker.getTypeAtLocation(statement).symbol);

					for (const member of statement.members) {
						if (ts.isMethodSignature(member)) {
							if (ts.isIdentifier(member.name)) {
								const methodName = member.name.text;
								let methodSymbols = interfaceInfo.methods.get(methodName);
								if (!methodSymbols) {
									methodSymbols = new Array<ts.Symbol>();
									interfaceInfo.methods.set(methodName, methodSymbols);
								}
								methodSymbols.push(typeChecker.getTypeAtLocation(member).symbol);
							}
						} else if (ts.isConstructSignatureDeclaration(member)) {
							interfaceInfo.constructors.push(member.symbol);
						}
					}
				}
			}
		}

		for (const [identifierName, macro] of Object.entries(IDENTIFIER_MACROS)) {
			const identifierSymbols = identifiers.get(identifierName);
			if (!identifierSymbols) {
				throw new ProjectError(`(MacroManager) No identifier found for ${identifierName}`);
			}
			for (const symbol of identifierSymbols) {
				this.identifierMacros.set(symbol, macro);
			}
		}

		for (const [funcName, macro] of Object.entries(CALL_MACROS)) {
			const functionSymbols = functions.get(funcName);
			if (!functionSymbols) {
				throw new ProjectError(`(MacroManager) No function found for ${funcName}`);
			}
			for (const symbol of functionSymbols) {
				this.callMacros.set(symbol, macro);
			}
		}

		for (const [className, macro] of Object.entries(CONSTRUCTOR_MACROS)) {
			const interfaceInfo = interfaces.get(className);
			if (!interfaceInfo) {
				throw new ProjectError(`(MacroManager) No interface found for ${className}`);
			}
			for (const symbol of interfaceInfo.constructors) {
				this.constructorMacros.set(symbol, macro);
			}
		}

		for (const [className, methods] of Object.entries(PROPERTY_CALL_MACROS)) {
			const interfaceInfo = interfaces.get(className);
			if (!interfaceInfo) {
				throw new ProjectError(`(MacroManager) No interface found for ${className}`);
			}
			for (const [methodName, macro] of Object.entries(methods)) {
				const methodSymbols = interfaceInfo.methods.get(methodName);
				if (!methodSymbols) {
					throw new ProjectError(`(MacroManager) No method found for ${className}.${methodName}`);
				}
				for (const methodSymbol of methodSymbols) {
					this.propertyCallMacros.set(methodSymbol, macro);
				}
			}
		}
	}

	public getIdentifierMacro(symbol: ts.Symbol) {
		return this.identifierMacros.get(symbol);
	}

	public getCallMacro(symbol: ts.Symbol) {
		return this.callMacros.get(symbol);
	}

	public getConstructorMacro(symbol: ts.Symbol) {
		return this.constructorMacros.get(symbol);
	}

	public getPropertyCallMacro(symbol: ts.Symbol) {
		return this.propertyCallMacros.get(symbol);
	}
}